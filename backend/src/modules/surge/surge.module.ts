import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { IsIn, IsInt, IsNotEmpty, IsOptional, Max, Min } from 'class-validator';
import { SurgePlan } from '../../entities/surge-plan.entity';
import { SurgeAllocation } from '../../entities/surge-allocation.entity';
import { DelayNotice } from '../../entities/delay-notice.entity';
import { PickingTask } from '../../entities/picking-task.entity';
import { CsScript } from '../../entities/cs-script.entity';
import { Order } from '../../entities/order.entity';
import { Batch } from '../../entities/batch.entity';
import { Livestream } from '../../entities/livestream.entity';
import { InventoryLock } from '../../entities/inventory-lock.entity';
import { ShippingTask } from '../../entities/shipping-task.entity';
import { Product } from '../../entities/product.entity';
import { Farmer } from '../../entities/farmer.entity';
import { Selection } from '../../entities/selection.entity';
import { Roles } from '../../common/decorators';
import { ReqUser } from '../../common/req-user.decorator';
import { RisksService } from '../risks/risks.module';
import { reachableCities } from '../products/products.module';

/** 各城市物流时效（天），未列出的按偏远 5 天计 */
const DELIVERY_DAYS: Record<string, number> = {
  杭州市: 1, 上海市: 1, 南京市: 1, 苏州市: 1, 宁波市: 2, 合肥市: 2,
  武汉市: 2, 长沙市: 2, 南昌市: 2, 福州市: 3, 北京市: 3, 广州市: 3,
  深圳市: 3, 郑州市: 3, 成都市: 4,
};

/** 可参与分配的批次状态（必须通过质检；pending/qc_failed 一律排除） */
const ALLOCATABLE_STATUS = ['qc_passed', 'on_sale', 'locked'];

const dayMs = 86400000;
const todayStr = () => new Date().toISOString().slice(0, 10);
const plusDays = (n: number) => new Date(Date.now() + n * dayMs).toISOString().slice(0, 10);

class CreatePlanDto {
  @IsInt() livestreamId: number;
}

class ChoiceDto {
  @IsIn(['wait', 'switch', 'refund']) choice: string;
  @IsOptional() @IsInt() switchToBatchId?: number;
}

class SubmitPickingDto {
  @IsInt() @Min(1) quantity: number;
}

class QcDto {
  @IsIn(['pass', 'fail']) result: string;
  @IsInt() @Min(1) @Max(10) score: number;
  @IsOptional() notes?: string;
}

/** 追加采摘质量要求（按品类生成） */
function qualityRequirements(product: Product): string {
  if (product.category === '水果') {
    return '成熟度 8 成以上（果皮转色≥80%）、糖度≥13°Bx、单果重≥180g、无病虫害与机械伤；采摘后 12 小时内送达县域中心仓，复检坏果率须＜3%，复检合格前不得混入已锁定批次发货';
  }
  if (product.category === '菌菇') {
    return '菇盖完整未开伞、无虫蛀霉斑、含水量≤13%；采摘后 24 小时内送达仓库复检，复检合格前不得混入已锁定批次发货';
  }
  return '按供货标准足量采摘，无病虫害、无霉变，48 小时内送达仓库复检，复检合格前不得混入已锁定批次发货';
}

@Injectable()
export class SurgeService {
  constructor(
    @InjectRepository(SurgePlan) private plans: Repository<SurgePlan>,
    @InjectRepository(SurgeAllocation) private allocations: Repository<SurgeAllocation>,
    @InjectRepository(DelayNotice) private notices: Repository<DelayNotice>,
    @InjectRepository(PickingTask) private pickingTasks: Repository<PickingTask>,
    @InjectRepository(CsScript) private scripts: Repository<CsScript>,
    @InjectRepository(Order) private orders: Repository<Order>,
    @InjectRepository(Batch) private batches: Repository<Batch>,
    @InjectRepository(Livestream) private livestreams: Repository<Livestream>,
    @InjectRepository(InventoryLock) private locks: Repository<InventoryLock>,
    @InjectRepository(ShippingTask) private tasks: Repository<ShippingTask>,
    @InjectRepository(Product) private products: Repository<Product>,
    @InjectRepository(Farmer) private farmers: Repository<Farmer>,
    @InjectRepository(Selection) private selections: Repository<Selection>,
    private risks: RisksService,
  ) {}

  /** 待分配订单：已支付且尚未生成发货任务，按付款时间升序 */
  private async pendingOrders(livestreamId: number) {
    const orders = await this.orders.find({
      where: { livestreamId, status: 'paid' },
      order: { createdAt: 'ASC', id: 'ASC' },
    });
    if (!orders.length) return [];
    const tasked = await this.tasks
      .createQueryBuilder('t')
      .select('t.order_id', 'oid')
      .where('t.order_id IN (:...ids)', { ids: orders.map((o) => o.id) })
      .getRawMany();
    const taskedIds = new Set(tasked.map((t) => t.oid));
    return orders.filter((o) => !taskedIds.has(o.id));
  }

  /**
   * 构建可分配库存池（仅已质检批次）：
   * 1) 本场锁定库存优先；2) 主批次剩余可售；3) 同商品其他已质检批次，
   * 按采摘日期升序（采摘早=成熟度高，先发避免过熟），已过采摘窗口的批次剔除。
   */
  private async buildPools(ls: Livestream, product: Product) {
    const pools: {
      label: string; batchId: number; batchNo: string; qty: number;
      harvestDate: string; lockId?: number; warehouseName?: string;
    }[] = [];
    const mainBatch = await this.batches.findOne({ where: { id: ls.batchId } });
    const locks = await this.locks.find({
      where: { livestreamId: ls.id },
      order: { id: 'ASC' },
    });
    for (const lk of locks.filter((l) => ['locked', 'consumed'].includes(l.status))) {
      if (lk.lockedQty > 0) {
        pools.push({
          label: `本场锁定库存（${lk.warehouseName}）`,
          batchId: mainBatch.id, batchNo: mainBatch.batchNo, qty: lk.lockedQty,
          harvestDate: mainBatch.harvestDate, lockId: lk.id, warehouseName: lk.warehouseName,
        });
      }
    }
    if (mainBatch.availableQty > 0) {
      pools.push({
        label: `主批次 ${mainBatch.batchNo} 可售库存`,
        batchId: mainBatch.id, batchNo: mainBatch.batchNo, qty: mainBatch.availableQty,
        harvestDate: mainBatch.harvestDate,
      });
    }
    const others = await this.batches.find({
      where: { productId: product.id },
      order: { harvestDate: 'ASC' },
    });
    const today = todayStr();
    for (const b of others) {
      if (b.id === mainBatch.id) continue;
      if (!ALLOCATABLE_STATUS.includes(b.status)) continue; // 必须已质检
      if (b.availableQty <= 0) continue;
      if (b.harvestWindowEnd < today) continue; // 过采摘窗口，成熟度过高不可用
      pools.push({
        label: `${b.source === 'picking_extra' ? '追加采摘批次' : '备选批次'} ${b.batchNo}`,
        batchId: b.id, batchNo: b.batchNo, qty: b.availableQty, harvestDate: b.harvestDate,
      });
    }
    return pools;
  }

  /** 批次剩余保质期是否覆盖该城市的物流时效（到货不过期） */
  private shelfLifeOk(batch: Batch, product: Product, city: string) {
    const need = (DELIVERY_DAYS[city] ?? 5) + 1; // 运输天数 + 1 天售后期
    const remain =
      product.shelfLifeDays -
      Math.floor((Date.now() - new Date(batch.harvestDate).getTime()) / dayMs);
    return remain >= need;
  }

  /** 爆单预检：需求、库存池、冷链不可达订单数（供前端预览） */
  async precheck(livestreamId: number) {
    const ls = await this.livestreams.findOne({ where: { id: livestreamId } });
    if (!ls) throw new NotFoundException('直播场次不存在');
    const batch = await this.batches.findOne({ where: { id: ls.batchId } });
    const product = batch.product;
    const orders = await this.pendingOrders(livestreamId);
    const demandQty = orders.reduce((s, o) => s + o.quantity, 0);
    const pools = await this.buildPools(ls, product);
    const reachable = reachableCities(product.tempZone);
    const unreachableCount = product.coldChainRequired
      ? orders.filter((o) => !reachable.includes(o.city)).length
      : 0;
    const plan = await this.plans.findOne({ where: { livestreamId } });
    return {
      livestream: { id: ls.id, title: ls.title, estimatedSales: ls.estimatedSales, actualSales: ls.actualSales, status: ls.status },
      product: { id: product.id, name: product.name, spec: product.spec, tempZone: product.tempZone, coldChainRequired: product.coldChainRequired },
      orderCount: orders.length,
      demandQty,
      pools: pools.map((p) => ({ label: p.label, batchNo: p.batchNo, qty: p.qty, harvestDate: p.harvestDate })),
      poolQty: pools.reduce((s, p) => s + p.qty, 0),
      unreachableCount,
      existingPlanId: plan?.id || null,
    };
  }

  /**
   * 生成爆单分配方案：
   * 按 已质检批次 → 采摘成熟度 → 物流时效 → 订单付款时间 分配；
   * 分不到的订单进入延迟通知，缺口生成农户追加采摘任务，并生成客服分层话术。
   */
  async createPlan(dto: CreatePlanDto) {
    const ls = await this.livestreams.findOne({ where: { id: dto.livestreamId } });
    if (!ls) throw new NotFoundException('直播场次不存在');
    const dup = await this.plans.findOne({ where: { livestreamId: ls.id } });
    if (dup) throw new ConflictException('该场次已生成过分配方案');
    const mainBatch = await this.batches.findOne({ where: { id: ls.batchId } });
    const product = mainBatch.product;
    const orders = await this.pendingOrders(ls.id);
    if (!orders.length) throw new BadRequestException('该场次没有待分配的已支付订单');

    const pools = await this.buildPools(ls, product);
    const reachable = reachableCities(product.tempZone);
    const expectedShipDate = plusDays(5); // 3 天采摘 + 1 天复检 + 1 天发运
    const lock = await this.locks.findOne({ where: { livestreamId: ls.id }, order: { id: 'DESC' } });

    const plan = await this.plans.save(
      this.plans.create({
        livestreamId: ls.id,
        batchId: ls.batchId,
        estimatedSales: ls.estimatedSales,
        actualSales: ls.actualSales,
        oversellTimes: ls.estimatedSales > 0 ? Math.round((ls.actualSales / ls.estimatedSales) * 100) / 100 : 0,
        orderCount: orders.length,
        status: 'executed',
      }),
    );

    const allocations: SurgeAllocation[] = [];
    const notices: DelayNotice[] = [];
    let shortageQty = 0;
    let rank = 0;
    for (const order of orders) {
      rank++;
      // 物流时效：冷链不可达城市直接延迟
      if (product.coldChainRequired && !reachable.includes(order.city)) {
        allocations.push(this.allocations.create({
          planId: plan.id, orderId: order.id, rankNo: rank, quantity: order.quantity,
          result: 'delayed', reason: `${order.city} 不在${product.tempZone}冷链可达范围，物流时效无法保证`,
        }));
        notices.push(this.notices.create({
          planId: plan.id, orderId: order.id, delayReason: 'logistics_unreachable',
          message: `您购买的「${product.name}」因收货地${product.tempZone}冷链暂不可达，无法按时发货。您可选择等待冷链排线、更换现货规格或申请退款。`,
          expectedShipDate, status: 'pending_choice',
        }));
        continue;
      }
      // 依次尝试库存池（已质检 + 成熟度排序 + 物流时效校验）
      let allocated: (typeof pools)[number] | null = null;
      for (const pool of pools) {
        if (pool.qty < order.quantity) continue;
        const poolBatch = pool.batchId === mainBatch.id
          ? mainBatch
          : await this.batches.findOne({ where: { id: pool.batchId } });
        if (!this.shelfLifeOk(poolBatch, product, order.city)) continue; // 物流时效不足，跳过
        allocated = pool;
        break;
      }
      if (allocated) {
        allocated.qty -= order.quantity;
        allocations.push(this.allocations.create({
          planId: plan.id, orderId: order.id, rankNo: rank, quantity: order.quantity,
          result: 'allocated', sourceBatchId: allocated.batchId,
          reason: `按付款时间第 ${rank} 位，从${allocated.label}分配（采摘 ${allocated.harvestDate}）`,
        }));
        await this.consumePool(allocated, order.quantity);
        await this.createShippingTask(order, allocated.batchId, lock?.warehouseName);
      } else {
        shortageQty += order.quantity;
        allocations.push(this.allocations.create({
          planId: plan.id, orderId: order.id, rankNo: rank, quantity: order.quantity,
          result: 'delayed', reason: '已质检库存不足，需等待农户追加采摘复检后补发',
        }));
        notices.push(this.notices.create({
          planId: plan.id, orderId: order.id, delayReason: 'stock_shortage',
          message: `您购买的「${product.name}」因本场爆单（销量达预估 ${plan.oversellTimes} 倍）库存不足，无法按时发货。已安排产地追加采摘并复检，预计 ${expectedShipDate} 前发出。您可选择等待、更换现货规格或申请退款。`,
          expectedShipDate, status: 'pending_choice',
        }));
      }
    }
    await this.allocations.save(allocations);
    await this.notices.save(notices);

    const allocatedCount = allocations.filter((a) => a.result === 'allocated').length;
    const delayedCount = allocations.length - allocatedCount;
    await this.plans.update(plan.id, { allocatedCount, delayedCount, shortageQty });

    // 缺口 → 农户追加采摘任务（追加批次必须重新质检，不得混入已锁定批次）
    if (shortageQty > 0) {
      await this.pickingTasks.save(
        this.pickingTasks.create({
          planId: plan.id,
          farmerId: product.farmerId,
          productId: product.id,
          requiredQty: shortageQty,
          qualityRequirements: qualityRequirements(product),
          deadline: plusDays(3),
          status: 'assigned',
        }),
      );
    }

    // 客服分层话术
    await this.generateScripts(plan, product.name, expectedShipDate, allocatedCount, delayedCount, shortageQty);

    await this.risks.emit(
      'oversell',
      plan.oversellTimes >= 2 ? 'critical' : 'warning',
      `直播「${ls.title}」爆单 ${plan.oversellTimes} 倍（${ls.actualSales}/${ls.estimatedSales}）：已分配按时发货 ${allocatedCount} 单，${delayedCount} 单进入延迟通知，库存缺口 ${shortageQty} 件已下发追加采摘任务`,
      ls.batchId,
      ls.id,
    );
    return this.planDetail(plan.id);
  }

  /** 扣减库存池：锁定池核销锁定记录，其余扣批次可售库存 */
  private async consumePool(pool: { batchId: number; qty: number; lockId?: number }, qty: number) {
    if (pool.lockId) {
      const lk = await this.locks.findOne({ where: { id: pool.lockId } });
      lk.lockedQty -= qty;
      if (lk.lockedQty <= 0) lk.status = 'consumed';
      await this.locks.save(lk);
    } else {
      await this.batches.decrement({ id: pool.batchId }, 'availableQty', qty);
    }
  }

  private async createShippingTask(order: Order, batchId: number, warehouseName?: string) {
    const batch = await this.batches.findOne({ where: { id: batchId } });
    const product = batch.product;
    const task = this.tasks.create({
      taskNo: `T${Date.now()}${Math.floor(Math.random() * 9000 + 1000)}`,
      orderId: order.id,
      batchId,
      warehouseName: warehouseName || '县域中心仓',
      tempZone: product.tempZone,
      carrier: product.coldChainRequired ? '顺丰冷运' : '中通快递',
      coldChainVehicle: product.coldChainRequired
        ? `冷链车-${product.tempZone === '冷冻' ? 'F' : 'C'}${100 + (order.id % 50)}`
        : null,
      promiseText: '坏果包赔、48小时发货',
      status: 'pending',
    });
    return this.tasks.save(task);
  }

  /** 客服分层话术：延迟发货 / 规格替换 / 退款等待时间 */
  private async generateScripts(
    plan: SurgePlan, productName: string, expectedShipDate: string,
    allocatedCount: number, delayedCount: number, shortageQty: number,
  ) {
    const rows: Partial<CsScript>[] = [
      {
        planId: plan.id, tier: 'delay', title: '延迟发货解释话术',
        content:
          `【延迟发货说明】您好，非常抱歉！本场「${productName}」直播订单量达预估的 ${plan.oversellTimes} 倍，` +
          `我们已按订单付款时间优先为 ${allocatedCount} 位用户发货，您的订单暂无法按时发出。` +
          `平台已安排产地农户追加采摘 ${shortageQty} 件，追加批次经平台重新质检合格后第一时间发货，预计 ${expectedShipDate} 前发出。` +
          `为表歉意将随单附赠 5 元优惠券；如您着急，也可选择更换现货规格或申请全额退款。`,
      },
      {
        planId: plan.id, tier: 'switch', title: '规格替换说明话术',
        content:
          `【规格替换说明】您好，因本场爆单，您下单的「${productName}」规格暂时缺货。` +
          `同产地现货规格（如精品礼盒装）可在 48 小时内发出，规格差异产生的差价由平台补贴、无需您补款。` +
          `替换批次均为质检合格批次，坏果包赔承诺不变。如您接受，我们立即为您改单发货；不接受也可继续等待或退款。`,
      },
      {
        planId: plan.id, tier: 'refund', title: '退款等待时间话术',
        content:
          `【退款说明】您好，已为您登记全额退款，无需退货。退款将原路退回您的支付账户，` +
          `预计 1-3 个工作日到账（银行卡最迟不超过 7 个工作日），到账后会有短信提醒。` +
          `本次爆单缺货给您带来不便，再次致歉；退款完成后订单关闭，如有疑问可随时联系客服。`,
      },
    ];
    await this.scripts.save(rows.map((r) => this.scripts.create(r)));
  }

  async planDetail(id: number) {
    const plan = await this.plans.findOne({ where: { id } });
    if (!plan) throw new NotFoundException('分配方案不存在');
    const ls = await this.livestreams.findOne({ where: { id: plan.livestreamId } });
    const allocations = await this.allocations.find({ where: { planId: id }, order: { rankNo: 'ASC' } });
    const orderIds = allocations.map((a) => a.orderId);
    const orders = orderIds.length ? await this.orders.find({ where: { id: In(orderIds) } }) : [];
    const orderMap = new Map(orders.map((o) => [o.id, o]));
    const batchIds = [...new Set(allocations.map((a) => a.sourceBatchId).filter(Boolean))];
    const batches = batchIds.length ? await this.batches.find({ where: { id: In(batchIds) } }) : [];
    const batchMap = new Map(batches.map((b) => [b.id, b]));
    const notices = await this.notices.find({ where: { planId: id }, order: { id: 'ASC' } });
    const pickingTasks = await this.pickingTasks.find({ where: { planId: id }, order: { id: 'ASC' } });
    const scripts = await this.scripts.find({ where: { planId: id }, order: { id: 'ASC' } });
    return {
      ...plan,
      livestreamTitle: ls?.title,
      allocations: allocations.map((a) => ({
        ...a,
        orderNo: orderMap.get(a.orderId)?.orderNo,
        customerName: orderMap.get(a.orderId)?.customerName,
        city: orderMap.get(a.orderId)?.city,
        paidAt: orderMap.get(a.orderId)?.createdAt,
        sourceBatchNo: a.sourceBatchId ? batchMap.get(a.sourceBatchId)?.batchNo : null,
      })),
      notices: notices.map((n) => ({
        ...n,
        orderNo: orderMap.get(n.orderId)?.orderNo,
        customerName: orderMap.get(n.orderId)?.customerName,
        city: orderMap.get(n.orderId)?.city,
        amount: orderMap.get(n.orderId)?.amount,
      })),
      pickingTasks,
      scripts,
    };
  }

  async listPlans() {
    const plans = await this.plans.find({ order: { id: 'DESC' } });
    const lss = plans.length
      ? await this.livestreams.find({ where: { id: In(plans.map((p) => p.livestreamId)) } })
      : [];
    const map = new Map(lss.map((l) => [l.id, l.title]));
    return plans.map((p) => ({ ...p, livestreamTitle: map.get(p.livestreamId) }));
  }

  /** 用户选择：等待 / 换规格 / 退款（客服代登记） */
  async choose(noticeId: number, dto: ChoiceDto) {
    const notice = await this.notices.findOne({ where: { id: noticeId } });
    if (!notice) throw new NotFoundException('延迟通知不存在');
    if (notice.status !== 'pending_choice') {
      throw new BadRequestException('该通知用户已做出选择，不可重复操作');
    }
    const order = await this.orders.findOne({ where: { id: notice.orderId } });
    notice.userChoice = dto.choice;
    notice.choiceAt = new Date();

    if (dto.choice === 'wait') {
      notice.status = 'waiting';
      notice.resolveNote = `用户选择等待，预计 ${notice.expectedShipDate} 前发货`;
    } else if (dto.choice === 'refund') {
      order.status = 'refunded';
      await this.orders.save(order);
      notice.status = 'refunded';
      notice.resolveNote = `退款 ¥${order.amount} 已发起，原路退回，预计 1-3 个工作日到账`;
    } else {
      // 换规格：目标批次必须质检合格、库存充足、物流可达
      if (!dto.switchToBatchId) throw new BadRequestException('请选择要更换的规格批次');
      const target = await this.batches.findOne({ where: { id: dto.switchToBatchId } });
      if (!target) throw new NotFoundException('目标批次不存在');
      if (!ALLOCATABLE_STATUS.includes(target.status)) {
        throw new BadRequestException('目标批次未通过质检，不可用于发货');
      }
      if (target.availableQty < order.quantity) {
        throw new BadRequestException(`目标批次库存不足（仅剩 ${target.availableQty} 件）`);
      }
      const tp = target.product;
      if (tp.coldChainRequired && !reachableCities(tp.tempZone).includes(order.city)) {
        throw new BadRequestException(`目标规格${tp.tempZone}冷链不可达 ${order.city}`);
      }
      target.availableQty -= order.quantity;
      target.soldQty += order.quantity;
      await this.batches.save(target);
      order.batchId = target.id;
      await this.orders.save(order);
      const plan = await this.plans.findOne({ where: { id: notice.planId } });
      const lock = await this.locks.findOne({ where: { livestreamId: plan.livestreamId }, order: { id: 'DESC' } });
      await this.createShippingTask(order, target.id, lock?.warehouseName);
      notice.status = 'switched';
      notice.switchedToBatchId = target.id;
      notice.resolveNote = `已换为「${tp.name}」（批次 ${target.batchNo}），差价平台补贴，48 小时内发货`;
    }
    await this.notices.save(notice);
    await this.maybeComplete(notice.planId);
    return notice;
  }

  /** 可换规格批次：同品类其他规格、已质检、有库存、物流可达 */
  async switchOptions(noticeId: number) {
    const notice = await this.notices.findOne({ where: { id: noticeId } });
    if (!notice) throw new NotFoundException('延迟通知不存在');
    const order = await this.orders.findOne({ where: { id: notice.orderId } });
    const curBatch = await this.batches.findOne({ where: { id: order.batchId } });
    const candidates = await this.batches.find({ order: { harvestDate: 'ASC' } });
    const out: any[] = [];
    for (const b of candidates) {
      if (b.id === order.batchId) continue;
      if (!ALLOCATABLE_STATUS.includes(b.status) || b.availableQty < order.quantity) continue;
      const p = b.product;
      if (!p || p.category !== curBatch.product.category || p.id === curBatch.product.id) continue;
      if (p.coldChainRequired && !reachableCities(p.tempZone).includes(order.city)) continue;
      out.push({
        batchId: b.id, batchNo: b.batchNo, productName: p.name, spec: p.spec,
        availableQty: b.availableQty, harvestDate: b.harvestDate,
      });
    }
    return out;
  }

  /** 追加采摘任务列表：农户看自己，运营看全部 */
  async listPickingTasks(user: any, planId?: number) {
    const where: any = {};
    if (planId) where.planId = planId;
    let tasks = await this.pickingTasks.find({ where, order: { id: 'DESC' } });
    if (user.role === 'farmer') {
      const farmer = await this.farmers.findOne({ where: { userId: user.sub } });
      tasks = tasks.filter((t) => t.farmerId === farmer?.id);
    }
    const out: any[] = [];
    for (const t of tasks) {
      const product = await this.products.findOne({ where: { id: t.productId } });
      const plan = await this.plans.findOne({ where: { id: t.planId } });
      const ls = plan ? await this.livestreams.findOne({ where: { id: plan.livestreamId } }) : null;
      const batch = t.batchId ? await this.batches.findOne({ where: { id: t.batchId } }) : null;
      out.push({
        ...t,
        productName: product?.name,
        spec: product?.spec,
        livestreamTitle: ls?.title,
        batchNo: batch?.batchNo || null,
        batchStatus: batch?.status || null,
      });
    }
    return out;
  }

  /** 农户提交追加采摘：生成独立新批次（pending 待质检），不并入任何已锁定库存 */
  async submitPicking(taskId: number, dto: SubmitPickingDto, user: any) {
    const task = await this.pickingTasks.findOne({ where: { id: taskId } });
    if (!task) throw new NotFoundException('采摘任务不存在');
    if (user.role === 'farmer') {
      const farmer = await this.farmers.findOne({ where: { userId: user.sub } });
      if (!farmer || farmer.id !== task.farmerId) throw new ForbiddenException('非本人采摘任务');
    }
    if (!['assigned', 'qc_failed'].includes(task.status)) {
      throw new BadRequestException(`任务状态 ${task.status} 不可提交`);
    }
    const product = await this.products.findOne({ where: { id: task.productId } });
    const plan = await this.plans.findOne({ where: { id: task.planId } });
    const mainBatch = await this.batches.findOne({ where: { id: plan.batchId } });
    const attempt = (await this.batches.count({ where: { pickingTaskId: task.id } })) + 1;
    const batch = await this.batches.save(
      this.batches.create({
        batchNo: `B${todayStr().replace(/-/g, '')}-EX${task.id}-${attempt}`,
        productId: product.id,
        quantity: dto.quantity,
        availableQty: dto.quantity,
        soldQty: 0,
        harvestDate: todayStr(),
        harvestWindowEnd: plusDays(Math.max(7, Math.floor(product.shelfLifeDays / 2))),
        supplyPrice: mainBatch.supplyPrice,
        testReportNo: null, // 复检合格后由质检环节补录
        testReportExpiry: null,
        livestreamAvailable: false,
        status: 'pending', // 待质检：合格前不可参与分配
        source: 'picking_extra',
        pickingTaskId: task.id,
      }),
    );
    task.status = 'submitted';
    task.submittedQty = dto.quantity;
    task.batchId = batch.id;
    task.submittedAt = new Date();
    await this.pickingTasks.save(task);
    return { task, batch };
  }

  /** 运营复检追加采摘批次：合格才放行补发等待中的订单 */
  async qcPicking(taskId: number, dto: QcDto, user: any) {
    const task = await this.pickingTasks.findOne({ where: { id: taskId } });
    if (!task) throw new NotFoundException('采摘任务不存在');
    if (task.status !== 'submitted') throw new BadRequestException('任务未处于待质检状态');
    const batch = await this.batches.findOne({ where: { id: task.batchId } });
    const passed = dto.result === 'pass';
    await this.selections.save(
      this.selections.create({
        batchId: batch.id,
        operatorId: user.sub,
        sampleTasteScore: dto.score,
        sampleNotes: dto.notes || '',
        decision: passed ? 'selected' : 'rejected',
        notes: '爆单追加采摘批次复检',
      }),
    );
    if (passed) {
      batch.status = 'qc_passed';
      batch.testReportNo = `EX-JC-${task.id}`;
      batch.testReportExpiry = plusDays(90);
    } else {
      batch.status = 'qc_failed';
    }
    await this.batches.save(batch);
    task.status = passed ? 'qc_passed' : 'qc_failed';
    task.qcNote = dto.notes || (passed ? '复检合格' : '复检不合格');
    await this.pickingTasks.save(task);

    if (passed) {
      await this.fulfillWaiting(task.planId, batch);
    } else {
      await this.risks.emit(
        'defect_rising',
        'critical',
        `追加采摘批次 ${batch.batchNo} 复检不合格（任务 #${task.id}），${task.submittedQty} 件不得发货，等待中的延迟订单需重新安排`,
        batch.id,
        null,
      );
    }
    return this.listPickingTasks({ role: 'operator' } as any, task.planId);
  }

  /** 追加批次复检合格后，按通知先后顺序补发选择「等待」的订单 */
  private async fulfillWaiting(planId: number, batch: Batch) {
    const waiting = await this.notices.find({
      where: { planId, status: 'waiting' },
      order: { id: 'ASC' },
    });
    const plan = await this.plans.findOne({ where: { id: planId } });
    const lock = await this.locks.findOne({ where: { livestreamId: plan.livestreamId }, order: { id: 'DESC' } });
    const product = batch.product;
    const reachable = reachableCities(product.tempZone);
    for (const notice of waiting) {
      const order = await this.orders.findOne({ where: { id: notice.orderId } });
      if (product.coldChainRequired && !reachable.includes(order.city)) continue; // 仍不可达，继续等待
      if (batch.availableQty < order.quantity) break; // 追加库存用完，剩余继续等待
      batch.availableQty -= order.quantity;
      batch.soldQty += order.quantity;
      await this.batches.save(batch);
      await this.createShippingTask(order, batch.id, lock?.warehouseName);
      notice.status = 'fulfilled';
      notice.resolveNote = `追加批次 ${batch.batchNo} 复检合格，已补发（任务单自动生成）`;
      await this.notices.save(notice);
    }
    await this.maybeComplete(planId);
  }

  /** 延迟通知全部处理完 → 方案收官 */
  private async maybeComplete(planId: number) {
    const open = await this.notices.count({
      where: [
        { planId, status: 'pending_choice' },
        { planId, status: 'waiting' },
      ],
    });
    if (open === 0) await this.plans.update(planId, { status: 'completed' });
  }

  async listNotices(query: any) {
    const where: any = {};
    if (query.planId) where.planId = +query.planId;
    if (query.status) where.status = query.status;
    const notices = await this.notices.find({ where, order: { id: 'ASC' }, take: 500 });
    const orderIds = notices.map((n) => n.orderId);
    const orders = orderIds.length ? await this.orders.find({ where: { id: In(orderIds) } }) : [];
    const map = new Map(orders.map((o) => [o.id, o]));
    return notices.map((n) => ({
      ...n,
      orderNo: map.get(n.orderId)?.orderNo,
      customerName: map.get(n.orderId)?.customerName,
      city: map.get(n.orderId)?.city,
      amount: map.get(n.orderId)?.amount,
    }));
  }

  listScripts(query: any) {
    const where: any = {};
    if (query.planId) where.planId = +query.planId;
    if (query.tier) where.tier = query.tier;
    return this.scripts.find({ where, order: { id: 'ASC' } });
  }
}

@Controller('surge')
export class SurgeController {
  constructor(private svc: SurgeService) {}

  @Get('precheck/:livestreamId')
  @Roles('operator')
  precheck(@Param('livestreamId') id: string) {
    return this.svc.precheck(+id);
  }

  @Post('plans')
  @Roles('operator')
  createPlan(@Body() dto: CreatePlanDto) {
    return this.svc.createPlan(dto);
  }

  @Get('plans')
  @Roles('operator', 'aftersales')
  listPlans() {
    return this.svc.listPlans();
  }

  @Get('plans/:id')
  @Roles('operator', 'aftersales')
  planDetail(@Param('id') id: string) {
    return this.svc.planDetail(+id);
  }

  @Get('notices')
  @Roles('operator', 'aftersales')
  listNotices(@Query() q: any) {
    return this.svc.listNotices(q);
  }

  @Post('notices/:id/choice')
  @Roles('operator', 'aftersales')
  choose(@Param('id') id: string, @Body() dto: ChoiceDto) {
    return this.svc.choose(+id, dto);
  }

  @Get('notices/:id/switch-options')
  @Roles('operator', 'aftersales')
  switchOptions(@Param('id') id: string) {
    return this.svc.switchOptions(+id);
  }

  @Get('picking-tasks')
  @Roles('operator', 'farmer')
  listPickingTasks(@ReqUser() user: any, @Query('planId') planId?: string) {
    return this.svc.listPickingTasks(user, planId ? +planId : undefined);
  }

  @Post('picking-tasks/:id/submit')
  @Roles('farmer', 'operator')
  submitPicking(@Param('id') id: string, @Body() dto: SubmitPickingDto, @ReqUser() user: any) {
    return this.svc.submitPicking(+id, dto, user);
  }

  @Post('picking-tasks/:id/qc')
  @Roles('operator')
  qcPicking(@Param('id') id: string, @Body() dto: QcDto, @ReqUser() user: any) {
    return this.svc.qcPicking(+id, dto, user);
  }

  @Get('scripts')
  @Roles('operator', 'aftersales')
  listScripts(@Query() q: any) {
    return this.svc.listScripts(q);
  }
}

@Module({
  imports: [
    TypeOrmModule.forFeature([
      SurgePlan, SurgeAllocation, DelayNotice, PickingTask, CsScript,
      Order, Batch, Livestream, InventoryLock, ShippingTask, Product, Farmer, Selection,
    ]),
  ],
  controllers: [SurgeController],
  providers: [SurgeService],
})
export class SurgeModule {}
