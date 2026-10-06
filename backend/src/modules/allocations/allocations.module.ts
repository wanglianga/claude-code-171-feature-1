import {
  BadRequestException,
  Body,
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
import { OrderAllocation } from '../../entities/order-allocation.entity';
import { HarvestTask } from '../../entities/harvest-task.entity';
import { DelayChoice } from '../../entities/delay-choice.entity';
import { CsScript } from '../../entities/cs-script.entity';
import { Order } from '../../entities/order.entity';
import { Livestream } from '../../entities/livestream.entity';
import { Batch } from '../../entities/batch.entity';
import { Product } from '../../entities/product.entity';
import { ShippingTask } from '../../entities/shipping-task.entity';
import { Roles } from '../../common/decorators';
import { ReqUser } from '../../common/req-user.decorator';
import { RisksService } from '../risks/risks.module';
import { FarmersService } from '../farmers/farmers.module';

const DAY = 86400000;

/** 产地仓到各城市的物流时效（天）——先远后近安排发货，保证长链路订单新鲜度 */
const CITY_TRANSIT_DAYS: Record<string, number> = {
  杭州市: 1, 上海市: 1, 南京市: 1, 合肥市: 1, 苏州市: 1, 宁波市: 1,
  武汉市: 2, 长沙市: 2, 南昌市: 2, 福州市: 2,
  北京市: 3, 广州市: 3, 深圳市: 3, 成都市: 3, 郑州市: 3,
};

const DELAY_CHOICES = ['wait', 'spec_change', 'refund'];

class ChooseDto {
  @IsIn(DELAY_CHOICES) choice: string;
  @IsOptional() specTarget?: string;
}

class DeliverDto {
  @IsInt() @Min(1) quantity: number;
  @IsNotEmpty() harvestDate: string;
  @IsNotEmpty() harvestWindowEnd: string;
  @IsInt() @Min(1) @Max(5) maturityGrade: number;
  @IsOptional() testReportNo?: string;
  @IsOptional() testReportExpiry?: string;
  @IsOptional() farmerNote?: string;
}

@Injectable()
export class AllocationsService {
  constructor(
    @InjectRepository(OrderAllocation) private allocations: Repository<OrderAllocation>,
    @InjectRepository(HarvestTask) private harvestTasks: Repository<HarvestTask>,
    @InjectRepository(DelayChoice) private delayChoices: Repository<DelayChoice>,
    @InjectRepository(CsScript) private scripts: Repository<CsScript>,
    @InjectRepository(Order) private orders: Repository<Order>,
    @InjectRepository(Livestream) private livestreams: Repository<Livestream>,
    @InjectRepository(Batch) private batches: Repository<Batch>,
    @InjectRepository(Product) private products: Repository<Product>,
    @InjectRepository(ShippingTask) private tasks: Repository<ShippingTask>,
    private risks: RisksService,
    private farmersSvc: FarmersService,
  ) {}

  private transitDays(city: string) {
    return CITY_TRANSIT_DAYS[city] ?? 2;
  }

  /** 批次成熟度：显式登记优先，否则按采摘后天数估算（每 2 天降 1 级） */
  private maturity(b: Batch): { grade: number; note: string } {
    const hint =
      b.maturityGrade ??
      Math.max(1, 5 - Math.floor((Date.now() - new Date(b.harvestDate).getTime()) / (2 * DAY)));
    const grade = Math.max(1, Math.min(5, hint));
    return {
      grade,
      note: `成熟度 ${grade}/5，采摘于 ${b.harvestDate}，窗口至 ${b.harvestWindowEnd}`,
    };
  }

  /**
   * 爆单分配（第 1 轮）
   * 已质检批次（硬门槛）→ 按采摘成熟度从高到低取货；
   * 订单按物流时效（先远后近）+ 付款时间（先付先发）排序；
   * 已质检库存不足以 48 小时发货的订单进入延迟通知。
   */
  async run(livestreamId: number) {
    const ls = await this.livestreams.findOne({ where: { id: livestreamId } });
    if (!ls) throw new NotFoundException('直播场次不存在');
    const existed = await this.allocations.count({ where: { livestreamId, roundNo: 1 } });
    if (existed > 0) throw new BadRequestException('该场次已完成爆单分配，追加批次复检通过后请执行补分配');

    const source = await this.batches.findOne({
      where: { id: ls.batchId },
      relations: ['product', 'product.farmer'],
    });
    if (!source) throw new NotFoundException('来源批次不存在');
    const product = source.product;

    // 仅对已支付未发货订单分配；已发货/已退款订单不再参与
    const orders = await this.orders.find({
      where: { livestreamId, status: 'paid' },
      order: { createdAt: 'ASC' },
    });
    if (!orders.length) throw new BadRequestException('该场次暂无可分配的已支付订单');

    // 已发货/在途/送达占用的货量不可再分配
    const committedRows = await this.tasks
      .createQueryBuilder('t')
      .select('t.batch_id', 'batch_id')
      .addSelect('COUNT(*)', 'cnt')
      .where('t.batch_id IS NOT NULL')
      .andWhere('t.status IN (:...sts)', { sts: ['shipped', 'in_transit', 'delivered'] })
      .groupBy('t.batch_id')
      .getRawMany<{ batch_id: number; cnt: string }>();
    const committed = new Map<number, number>(committedRows.map((r) => [+r.batch_id, +r.cnt]));

    // 候选批次：本场锁定批次 + 同商品已质检通过的其他批次；
    // 未质检/质检不合格/未复检的追加批次一律排除（铁律）
    const sameProduct = await this.batches.find({
      where: { productId: product.id },
      order: { id: 'ASC' },
    });
    const today = new Date().toISOString().slice(0, 10);
    const candidates = sameProduct
      .filter((b) => {
        if (b.id === source.id) return !['closed', 'qc_failed'].includes(b.status);
        if (b.status !== 'qc_passed') return false;
        if (b.isSupplement) return false; // 追加批次只能经补分配进入
        if (b.testReportExpiry && b.testReportExpiry < today) return false;
        if (b.harvestWindowEnd < today) return false;
        return true;
      })
      .map((b) => {
        const m = this.maturity(b);
        const pool = Math.max(
          0,
          (b.id === source.id ? b.quantity : b.availableQty) - (committed.get(b.id) || 0),
        );
        return { batch: b, grade: m.grade, note: m.note, pool };
      })
      // 来源批次优先发运，其余按成熟度从高到低、采摘日期从近到远
      .sort((a, b) => {
        if ((a.batch.id === source.id) !== (b.batch.id === source.id)) {
          return a.batch.id === source.id ? -1 : 1;
        }
        if (b.grade !== a.grade) return b.grade - a.grade;
        return a.batch.harvestDate < b.batch.harvestDate ? 1 : -1;
      });

    const totalPool = candidates.reduce((s, c) => s + c.pool, 0);

    // 订单优先级：物流时效（长途先发，48h 承诺下远单更紧迫）+ 付款先后（先付先发）
    const ranked = orders.map((o, idx) => {
      const days = this.transitDays(o.city);
      return {
        order: o,
        payRank: idx + 1,
        logisticsDays: days,
        score: days * 100 + (orders.length - idx),
      };
    });
    ranked.sort((a, b) => b.score - a.score);

    const allocRecs: OrderAllocation[] = [];
    const delayedIds = new Set<number>();
    const pools = candidates.map((c) => ({ ...c, remain: c.pool }));

    for (const r of ranked) {
      const target = pools.find((p) => p.remain >= r.order.quantity);
      const promisedShipAt = new Date(r.order.createdAt.getTime() + 2 * DAY); // 承诺 48 小时发货
      if (!target) {
        delayedIds.add(r.order.id);
        allocRecs.push(
          this.allocations.create({
            livestreamId,
            orderId: r.order.id,
            batchId: null,
            roundNo: 1,
            status: 'delayed',
            logisticsDays: r.logisticsDays,
            onTime: false,
            payRank: r.payRank,
            score: r.score,
            delayReason: `已质检库存 ${totalPool} 件已分完，需等待追加采摘批次重新质检后补发`,
            promisedShipAt,
          }),
        );
        continue;
      }
      target.remain -= r.order.quantity;
      allocRecs.push(
        this.allocations.create({
          livestreamId,
          orderId: r.order.id,
          batchId: target.batch.id,
          roundNo: 1,
          status: 'allocated',
          maturityGrade: target.grade,
          maturityNote: target.note,
          logisticsDays: r.logisticsDays,
          onTime: true,
          payRank: r.payRank,
          score: r.score,
          promisedShipAt,
          eta: new Date(promisedShipAt.getTime() + r.logisticsDays * DAY),
        }),
      );
    }

    await this.allocations.save(allocRecs);

    // 订单与发货任务联动：延迟任务挂起等待补库，禁止从来源批次强行发货
    for (const oid of delayedIds) {
      await this.orders.update(oid, { fulfillStatus: 'delayed' });
      await this.tasks.update({ orderId: oid, status: 'pending' }, { status: 'waiting_stock' });
    }
    for (const r of ranked) {
      if (!delayedIds.has(r.order.id)) {
        await this.orders.update(r.order.id, { fulfillStatus: 'allocated' });
      }
    }

    // 延迟通知 + 追加采摘任务 + 风险 + 分层话术
    let harvestTask: HarvestTask | null = null;
    const delayedCount = delayedIds.size;
    if (delayedCount) {
      const waitDate = new Date(Date.now() + 5 * DAY).toISOString().slice(0, 10);
      const delayedRanked = ranked.filter((x) => delayedIds.has(x.order.id));
      for (const r of delayedRanked) {
        const saved = allocRecs.find((a) => a.orderId === r.order.id)!;
        await this.delayChoices.save(
          this.delayChoices.create({
            allocationId: saved.id,
            orderId: r.order.id,
            livestreamId,
            status: 'notified',
            promisedWaitDate: waitDate,
            refundWaitNote: '退款审核通过后 1-3 个工作日按原支付渠道退回，最迟不超过 7 个自然日',
          }),
        );
      }

      // 追加数量按延迟订单总件数计算，含 10% 质检损耗冗余
      const delayedQty = delayedRanked.reduce((s, r) => s + r.order.quantity, 0);
      const requiredQty = Math.ceil(delayedQty * 1.1);
      harvestTask = await this.harvestTasks.save(
        this.harvestTasks.create({
          taskNo: `HC${Date.now()}${Math.floor(Math.random() * 900 + 100)}`,
          productId: product.id,
          farmerId: product.farmerId,
          livestreamId,
          sourceBatchId: source.id,
          requiredQty,
          delayedOrderCount: delayedCount,
          requiredMaturityGrade: 4,
          qualityRequirements:
            '1) 成熟度达到 4/5 以上（八成熟起摘，到手放 1-2 天达最佳口感）；' +
            '2) 糖度不低于本场选品标准，果径 75mm 以上，无碰压伤、无病斑虫眼；' +
            '3) 坏果率须≤3%，逐果套网套+泡沫托装箱；' +
            '4) 必须随附 7 天内农残检测合格报告，报告有效期覆盖售后期；' +
            '5) 采后 24 小时内按规定温区冷链入库。追加批次须重新质检合格后方可发货，不得直接混入已锁定批次。',
          requiredDeliverAt: new Date(Date.now() + 2 * DAY),
          status: 'issued',
        }),
      );

      await this.risks.emit(
        'allocation_delay',
        'critical',
        `直播「${ls.title}」爆单 ${orders.length} 单（预估 ${ls.estimatedSales}），已质检库存 ${totalPool} 件按成熟度/物流时效/付款时间分配后，仍有 ${delayedCount} 单无法 48 小时内发货，已进入延迟通知并向农户「${product.farmer?.name || ''}」下达追加采摘 ${requiredQty} 件任务（交付后须重新质检）`,
        source.id,
        ls.id,
      );

      await this.generateScripts(ls, product.name, delayedCount, waitDate);
    }

    return {
      livestreamId,
      totalOrders: orders.length,
      estimatedSales: ls.estimatedSales,
      qcStock: totalPool,
      allocated: orders.length - delayedCount,
      delayed: delayedCount,
      candidateBatches: candidates.map((c) => ({
        batchId: c.batch.id,
        batchNo: c.batch.batchNo,
        maturityGrade: c.grade,
        pool: c.pool,
        isSupplement: c.batch.isSupplement,
      })),
      harvestTaskId: harvestTask?.id || null,
    };
  }

  /** 客服分层话术：3 类场景（延迟发货/规格替换/退款等待）× 3 个客户情绪层级 */
  private async generateScripts(ls: Livestream, productName: string, delayedCount: number, waitDate: string) {
    const l3 = Math.round(delayedCount * 0.1);
    const l2 = Math.round(delayedCount * 0.3);
    const l1 = delayedCount - l3 - l2;
    const levels = [
      { key: 'L1', label: '情绪平稳客户', count: l1 },
      { key: 'L2', label: '催促/抱怨客户', count: l2 },
      { key: 'L3', label: '强烈不满/投诉倾向客户', count: l3 },
    ];
    const tpl: Record<string, Record<string, { title: string; content: string }>> = {
      delayed_ship: {
        L1: {
          title: '延迟发货说明（平稳客户）',
          content: `您好，感谢支持「${ls.title}」~ 本场${productName}订单量超过预估两倍，平台已按已质检批次、采摘成熟度、物流时效和付款顺序为您尽力排单。为保证发出的每一箱都经过质检，您的订单将在追加采摘批次复检合格后于 ${waitDate} 前发出，随箱附赠一份高山果品尝鲜装，发货后第一时间短信告知您单号。`,
        },
        L2: {
          title: '延迟发货说明（催促客户）',
          content: `非常抱歉让您久等了！「${ls.title}」爆单后已质检库存确实不足，平台不会把未经质检的追加果品直接发给您——新批次正在加急采摘，糖度、果径和农残复检通过后立即按付款先后补发，预计 ${waitDate} 前发出。您也可以选择换同价位现货规格（今天就能发）或全额退款，我们立刻为您办理。`,
        },
        L3: {
          title: '延迟发货说明（强烈不满客户）',
          content: `真的非常抱歉，给您造成了不好的体验，我完全理解您的心情。「${ls.title}」订单超预估两倍，为坚守「坏果包赔、48 小时发货」的承诺，未质检的追加批次我们坚决不发。现在为您提供三个方案：①继续等待，${waitDate} 前复检合格优先补发并赠送补偿；②更换同规格现货，今日发出；③全额退款，审核后 1-3 个工作日原路退回。请您选择，我全程跟进直到您满意。`,
        },
      },
      spec_replace: {
        L1: {
          title: '规格替换说明（平稳客户）',
          content: `您好，您下单的${productName}原规格需等待追加批次复检。现有同果园「4.5kg/箱 20 枚装（单果 200g+）」现货，品质同一质检标准，今天即可冷链发出。若您接受，我们直接为您改配，不另收差价。`,
        },
        L2: {
          title: '规格替换说明（催促客户）',
          content: `理解您想早点收到~ 原规格要等追加批次重新质检（约 ${waitDate}），等不及建议换同价位现货规格：同一片果园、同样糖度标准、冷链今日发。重量差异部分折算赠品补齐，您看可以吗？`,
        },
        L3: {
          title: '规格替换说明（强烈不满客户）',
          content: `非常抱歉让您反复操心。为尽快弥补，我们为您安排同果园现货规格替换：同等质检与坏果包赔标准、今日冷链发出，差价多退少不补，并额外赠送一份补偿。若替换规格您仍不满意，可随时改为全额退款，绝不影响您的任何权益。`,
        },
      },
      refund_wait: {
        L1: {
          title: '退款到账等待说明（平稳客户）',
          content: `您好，您的退款已登记。财务审核通过后 1-3 个工作日按原支付渠道退回，最迟不超过 7 个自然日，到账会有短信提醒，期间有任何问题随时联系我。`,
        },
        L2: {
          title: '退款到账等待说明（催促客户）',
          content: `抱歉给您添麻烦了！退款已为您加急提交审核，通过后 1-3 个工作日原路退回（银行卡可能稍慢于微信/支付宝），最迟不超过 7 个自然日。审核通过时我会主动留言告知您进度。`,
        },
        L3: {
          title: '退款到账等待说明（强烈不满客户）',
          content: `非常抱歉，退款我立即为您走加急通道：今天内完成审核，1-3 个工作日原路退回，到账前我跟进每一个节点并向您同步。若超过 7 个自然日未到账，平台先行垫付并额外补偿，请您放心。`,
        },
      },
    };
    const recs: CsScript[] = [];
    for (const type of ['delayed_ship', 'spec_replace', 'refund_wait'] as const) {
      for (const lv of levels) {
        recs.push(
          this.scripts.create({
            livestreamId: ls.id,
            scriptType: type,
            audienceLevel: lv.key,
            audienceLabel: lv.label,
            title: tpl[type][lv.key].title,
            content: tpl[type][lv.key].content,
            coveredOrders: lv.count,
          }),
        );
      }
    }
    await this.scripts.delete({ livestreamId: ls.id });
    await this.scripts.save(recs);
  }

  /** 分配结果明细（带订单与批次） */
  async result(livestreamId: number) {
    const rows = await this.allocations
      .createQueryBuilder('a')
      .leftJoinAndMapOne('a.order', Order, 'o', 'o.id = a.order_id')
      .leftJoinAndMapOne('a.batch', Batch, 'b', 'b.id = a.batch_id')
      .where('a.livestream_id = :id', { id: livestreamId })
      .orderBy('a.status', 'ASC')
      .addOrderBy('a.score', 'DESC')
      .getMany();
    const summary = await this.summary(livestreamId);
    return { ...summary, rows };
  }

  private async summary(livestreamId: number) {
    const rows = await this.allocations.find({ where: { livestreamId } });
    return {
      livestreamId,
      total: rows.length,
      allocated: rows.filter((r) => r.status === 'allocated').length,
      delayed: rows.filter((r) => r.status === 'delayed').length,
      fulfilled: rows.filter((r) => r.status === 'fulfilled').length,
    };
  }

  /** 延迟通知列表（含用户选择） */
  delayedList(query: any) {
    const qb = this.delayChoices
      .createQueryBuilder('d')
      .leftJoinAndMapOne('d.allocation', OrderAllocation, 'a', 'a.id = d.allocation_id')
      .leftJoinAndMapOne('d.order', Order, 'o', 'o.id = d.order_id')
      .orderBy('d.id', 'DESC')
      .limit(1000);
    if (query.livestreamId) qb.andWhere('d.livestream_id = :id', { id: +query.livestreamId });
    if (query.status) qb.andWhere('d.status = :st', { st: query.status });
    return qb.getMany();
  }

  /** 用户三选一：等待 / 换规格 / 退款（客服代为登记） */
  async choose(allocationId: number, dto: ChooseDto) {
    const alloc = await this.allocations.findOne({ where: { id: allocationId } });
    if (!alloc) throw new NotFoundException('分配记录不存在');
    if (alloc.status !== 'delayed') throw new BadRequestException('仅延迟订单可登记用户选择');
    const choice = await this.delayChoices.findOne({ where: { allocationId } });
    if (!choice) throw new NotFoundException('延迟通知不存在');
    if (!['notified', 'wait'].includes(choice.status)) {
      throw new BadRequestException('该订单选择已确定，不能重复修改');
    }

    choice.status = dto.choice;
    choice.chosenAt = new Date();
    if (dto.choice === 'spec_change') {
      choice.specChangeTarget = dto.specTarget || '同果园现货规格（4.5kg/箱 20 枚装，同质检标准）';
    }
    await this.delayChoices.save(choice);

    if (dto.choice === 'wait') {
      await this.orders.update(alloc.orderId, { fulfillStatus: 'waiting' });
    } else if (dto.choice === 'spec_change') {
      await this.orders.update(alloc.orderId, { fulfillStatus: 'spec_changed' });
      // 原规格发货任务取消，改由现货规格重新开单发货
      await this.tasks.update({ orderId: alloc.orderId }, { status: 'cancelled' });
    } else {
      await this.orders.update(alloc.orderId, { fulfillStatus: 'refund_pending' });
      await this.tasks.update({ orderId: alloc.orderId }, { status: 'cancelled' });
    }
    return choice;
  }

  /**
   * 补分配：追加采摘批次重新质检通过后，对选择等待（或尚未选择）的延迟订单补发。
   * 铁律：未重新质检的追加批次不能用于补分配、不能混入已锁定批次。
   */
  async rerun(livestreamId: number) {
    const ls = await this.livestreams.findOne({ where: { id: livestreamId } });
    if (!ls) throw new NotFoundException('直播场次不存在');
    const source = await this.batches.findOne({
      where: { id: ls.batchId },
      relations: ['product'],
    });

    const delayedAllocs = await this.allocations.find({
      where: { livestreamId, status: 'delayed' },
      order: { score: 'DESC' },
    });
    if (!delayedAllocs.length) throw new BadRequestException('没有待补分配的延迟订单');

    const choices = await this.delayChoices.find({
      where: { livestreamId, allocationId: In(delayedAllocs.map((a) => a.id)) },
    });
    const choiceMap = new Map(choices.map((c) => [c.allocationId, c]));
    const waitAllocs = delayedAllocs.filter((a) => {
      const c = choiceMap.get(a.id);
      return !c || ['notified', 'wait'].includes(c.status);
    });
    if (!waitAllocs.length) {
      throw new BadRequestException('延迟订单均已选择换规格或退款，无需补分配');
    }

    // 可补库存：本场追加采摘任务交付、且已重新质检通过的追加批次优先；
    // 其次本商品其他质检通过批次；原锁定批次与未复检追加批次一律排除
    const ownTasks = await this.harvestTasks.find({ where: { sourceBatchId: source.id } });
    const ownSupplementIds = new Set(
      ownTasks.filter((t) => t.supplementBatchId).map((t) => t.supplementBatchId),
    );
    const today = new Date().toISOString().slice(0, 10);
    const candidates = (await this.batches.find({ where: { productId: source.productId } }))
      .filter((b) => {
        if (b.status !== 'qc_passed') return false; // 硬门槛：重新质检合格
        if (b.id === source.id) return false;
        if (b.isSupplement && !ownSupplementIds.has(b.id)) return false; // 不跨场次串用追加批次
        if (b.testReportExpiry && b.testReportExpiry < today) return false;
        if (b.harvestWindowEnd < today) return false;
        return true;
      })
      .map((b) => ({ batch: b, ...this.maturity(b), remain: b.availableQty }))
      .sort((a, b) => {
        if (a.batch.isSupplement !== b.batch.isSupplement) return a.batch.isSupplement ? -1 : 1;
        if (b.grade !== a.grade) return b.grade - a.grade;
        return a.batch.harvestDate < b.batch.harvestDate ? 1 : -1;
      });

    const poolTotal = candidates.reduce((s, c) => s + c.remain, 0);
    if (poolTotal === 0) {
      throw new BadRequestException('尚无重新质检通过的追加批次，未质检批次禁止补发货');
    }

    let fulfilled = 0;
    const usedBatches = new Map<number, { batchNo: string; isSupplement: boolean }>();
    let stillDelayed = 0;
    for (const alloc of waitAllocs) {
      const order = await this.orders.findOne({ where: { id: alloc.orderId } });
      const qty = order?.quantity || 1;
      const target = candidates.find((c) => c.remain >= qty);
      if (!target) {
        stillDelayed++;
        continue;
      }
      target.remain -= qty;
      usedBatches.set(target.batch.id, {
        batchNo: target.batch.batchNo,
        isSupplement: target.batch.isSupplement,
      });
      alloc.batchId = target.batch.id;
      alloc.roundNo = 2;
      alloc.status = 'fulfilled';
      alloc.maturityGrade = target.grade;
      alloc.maturityNote = target.note + (target.batch.isSupplement ? '（追加批次·已重新质检）' : '');
      alloc.onTime = true;
      alloc.delayReason = null;
      const now = new Date();
      alloc.promisedShipAt = now;
      alloc.eta = new Date(now.getTime() + (alloc.logisticsDays ?? 2) * DAY);
      await this.allocations.save(alloc);

      target.batch.availableQty = Math.max(0, target.batch.availableQty - qty);
      target.batch.soldQty += qty;
      await this.batches.save(target.batch);

      // 恢复并改配发货任务（明确挂到复检合格的追加批次，与已锁定批次区分）
      let task = await this.tasks.findOne({ where: { orderId: alloc.orderId } });
      const promise = `追加批次复检合格补发（${target.batch.batchNo}）·坏果包赔`;
      if (task) {
        task.batchId = target.batch.id;
        task.status = 'pending';
        task.promiseText = promise;
        await this.tasks.save(task);
      } else {
        await this.tasks.save(
          this.tasks.create({
            taskNo: `T${Date.now()}${Math.floor(Math.random() * 9000 + 1000)}`,
            orderId: order.id,
            batchId: target.batch.id,
            warehouseName: '县域中心仓',
            tempZone: source.product.tempZone,
            carrier: source.product.coldChainRequired ? '顺丰冷运' : '中通快递',
            coldChainVehicle: source.product.coldChainRequired
              ? `冷链车-C${100 + (order.id % 50)}`
              : null,
            promiseText: promise,
            status: 'pending',
          }),
        );
      }
      await this.orders.update(alloc.orderId, { fulfillStatus: 'fulfilled' });
      fulfilled += 1;
    }

    return {
      livestreamId,
      waitingOrders: waitAllocs.length,
      supplementStock: poolTotal,
      fulfilled,
      stillDelayed,
      usedBatches: [...usedBatches.values()],
    };
  }

  listHarvestTasks(user: any) {
    const where: any = {};
    if (user.role === 'farmer') where.farmerId = user.farmerId;
    return this.harvestTasks.find({ where, order: { id: 'DESC' } });
  }

  private async getOwnedTask(id: number, user: any) {
    const t = await this.harvestTasks.findOne({ where: { id } });
    if (!t) throw new NotFoundException('追加采摘任务不存在');
    if (user.role === 'farmer' && t.farmerId !== user.farmerId) {
      throw new ForbiddenException('只能处理本农户的采摘任务');
    }
    return t;
  }

  async acceptTask(id: number, user: any) {
    const t = await this.getOwnedTask(id, user);
    if (t.status !== 'issued') throw new BadRequestException('仅已下达待接单的任务可接单');
    t.status = 'accepted';
    return this.harvestTasks.save(t);
  }

  /** 农户交付追加采摘：生成独立追加批次（pending），必须经选品质检重新通过 */
  async deliverTask(id: number, dto: DeliverDto, user: any) {
    const t = await this.getOwnedTask(id, user);
    if (!['accepted', 'issued'].includes(t.status)) {
      throw new BadRequestException('该采摘任务已交付或已关闭');
    }
    const product = await this.products.findOne({ where: { id: t.productId } });
    if (!product) throw new NotFoundException('商品不存在');
    const source = await this.batches.findOne({ where: { id: t.sourceBatchId } });
    const batchNo = `B${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-SUP-${t.id}`;
    const batch = await this.batches.save(
      this.batches.create({
        batchNo,
        productId: product.id,
        quantity: dto.quantity,
        availableQty: dto.quantity,
        soldQty: 0,
        harvestDate: dto.harvestDate,
        harvestWindowEnd: dto.harvestWindowEnd,
        supplyPrice: (source?.supplyPrice ?? 0) as any,
        maturityGrade: dto.maturityGrade,
        isSupplement: true,
        sourceBatchId: t.sourceBatchId,
        testReportNo: dto.testReportNo || null,
        testReportExpiry: dto.testReportExpiry || null,
        livestreamAvailable: true,
        status: 'pending', // 强制待质检，不能直接混入已锁定批次发货
        defectRate: 0,
      }),
    );

    t.status = 'delivered';
    t.supplementBatchId = batch.id;
    t.farmerNote = dto.farmerNote || null;
    await this.harvestTasks.save(t);
    await this.farmersSvc.recomputeStats(t.farmerId);
    return { task: t, supplementBatch: batch };
  }

  listScripts(livestreamId: number) {
    return this.scripts.find({ where: { livestreamId }, order: { id: 'ASC' } });
  }
}

@Controller('allocations')
export class AllocationsController {
  constructor(private svc: AllocationsService) {}

  @Post('run/:livestreamId')
  @Roles('operator', 'warehouse')
  run(@Param('livestreamId') id: string) {
    return this.svc.run(+id);
  }

  @Post('rerun/:livestreamId')
  @Roles('operator', 'warehouse')
  rerun(@Param('livestreamId') id: string) {
    return this.svc.rerun(+id);
  }

  @Get('result/:livestreamId')
  @Roles('operator', 'aftersales', 'warehouse')
  result(@Param('livestreamId') id: string) {
    return this.svc.result(+id);
  }

  @Get('delayed')
  @Roles('operator', 'aftersales', 'warehouse')
  delayed(@Query() q: any) {
    return this.svc.delayedList(q);
  }

  @Post('delay/:id/choose')
  @Roles('operator', 'aftersales')
  choose(@Param('id') id: string, @Body() dto: ChooseDto) {
    return this.svc.choose(+id, dto);
  }

  @Get('harvest-tasks')
  tasks(@ReqUser() user: any) {
    return this.svc.listHarvestTasks(user);
  }

  @Post('harvest-tasks/:id/accept')
  @Roles('farmer', 'operator')
  accept(@Param('id') id: string, @ReqUser() user: any) {
    return this.svc.acceptTask(+id, user);
  }

  @Post('harvest-tasks/:id/deliver')
  @Roles('farmer', 'operator')
  deliver(@Param('id') id: string, @Body() dto: DeliverDto, @ReqUser() user: any) {
    return this.svc.deliverTask(+id, dto, user);
  }

  @Get('scripts/:livestreamId')
  @Roles('operator', 'aftersales')
  scripts(@Param('livestreamId') id: string) {
    return this.svc.listScripts(+id);
  }
}

@Module({
  imports: [
    TypeOrmModule.forFeature([
      OrderAllocation, HarvestTask, DelayChoice, CsScript,
      Order, Livestream, Batch, Product, ShippingTask,
    ]),
  ],
  controllers: [AllocationsController],
  providers: [AllocationsService],
  exports: [AllocationsService],
})
export class AllocationsModule {}
