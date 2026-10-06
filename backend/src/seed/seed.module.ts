import { Injectable, Logger, Module, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { User } from '../entities/user.entity';
import { Farmer } from '../entities/farmer.entity';
import { Product } from '../entities/product.entity';
import { Batch } from '../entities/batch.entity';
import { Selection } from '../entities/selection.entity';
import { Livestream } from '../entities/livestream.entity';
import { InventoryLock } from '../entities/inventory-lock.entity';
import { Order } from '../entities/order.entity';
import { ShippingTask } from '../entities/shipping-task.entity';
import { Aftersale } from '../entities/aftersale.entity';
import { Settlement } from '../entities/settlement.entity';
import { RiskEvent } from '../entities/risk-event.entity';
import { BrandNotice } from '../entities/brand-notice.entity';
import { FeedbackDecision } from '../entities/feedback-decision.entity';
import { OrderAllocation } from '../entities/order-allocation.entity';
import { HarvestTask } from '../entities/harvest-task.entity';
import { DelayChoice } from '../entities/delay-choice.entity';
import { CsScript } from '../entities/cs-script.entity';

const CITIES = ['杭州市', '上海市', '南京市', '合肥市', '苏州市', '宁波市', '武汉市', '长沙市'];
const SURNAMES = ['王', '李', '张', '刘', '陈', '杨', '赵', '黄', '周', '吴', '徐', '孙'];
const GIVEN = ['芳', '伟', '敏', '静', '磊', '洋', '艳', '勇', '杰', '娟', '涛', '雪'];

@Injectable()
export class SeedService implements OnApplicationBootstrap {
  private log = new Logger('Seed');

  constructor(
    @InjectRepository(User) private users: Repository<User>,
    @InjectRepository(Farmer) private farmers: Repository<Farmer>,
    @InjectRepository(Product) private products: Repository<Product>,
    @InjectRepository(Batch) private batches: Repository<Batch>,
    @InjectRepository(Selection) private selections: Repository<Selection>,
    @InjectRepository(Livestream) private livestreams: Repository<Livestream>,
    @InjectRepository(InventoryLock) private locks: Repository<InventoryLock>,
    @InjectRepository(Order) private orders: Repository<Order>,
    @InjectRepository(ShippingTask) private tasks: Repository<ShippingTask>,
    @InjectRepository(Aftersale) private aftersales: Repository<Aftersale>,
    @InjectRepository(Settlement) private settlements: Repository<Settlement>,
    @InjectRepository(RiskEvent) private risks: Repository<RiskEvent>,
    @InjectRepository(BrandNotice) private notices: Repository<BrandNotice>,
    @InjectRepository(FeedbackDecision) private decisions: Repository<FeedbackDecision>,
    @InjectRepository(OrderAllocation) private allocations: Repository<OrderAllocation>,
    @InjectRepository(HarvestTask) private harvestTasks: Repository<HarvestTask>,
    @InjectRepository(DelayChoice) private delayChoices: Repository<DelayChoice>,
    @InjectRepository(CsScript) private csScripts: Repository<CsScript>,
  ) {}

  async onApplicationBootstrap() {
    const count = await this.users.count();
    if (count > 0) return;
    this.log.log('数据库为空，写入演示种子数据…');
    await this.seed();
    this.log.log('种子数据完成');
  }

  private seq = 0;
  private no(prefix: string) {
    this.seq++;
    return `${prefix}2026${String(this.seq).padStart(5, '0')}`;
  }

  private async seed() {
    // ---------- 用户 ----------
    const hash = (p: string) => bcrypt.hashSync(p, 10);
    const users = await this.users.save([
      this.users.create({ username: 'admin', password: hash('admin123'), name: '县域运营中心', role: 'admin' }),
      this.users.create({ username: 'ops', password: hash('123456'), name: '陈选品', role: 'operator' }),
      this.users.create({ username: 'farmer1', password: hash('123456'), name: '李青山', role: 'farmer' }),
      this.users.create({ username: 'farmer2', password: hash('123456'), name: '王菌业', role: 'farmer' }),
      this.users.create({ username: 'farmer3', password: hash('123456'), name: '张蜜坊', role: 'farmer' }),
      this.users.create({ username: 'farmer4', password: hash('123456'), name: '刘腊味', role: 'farmer' }),
      this.users.create({ username: 'warehouse', password: hash('123456'), name: '赵仓管', role: 'warehouse' }),
      this.users.create({ username: 'aftersales', password: hash('123456'), name: '孙售后', role: 'aftersales' }),
    ]);
    const [admin, ops, fu1, fu2, fu3, fu4] = users;

    // ---------- 农户 ----------
    const [f1, f2, f3, f4] = await this.farmers.save([
      this.farmers.create({ name: '青山果园', region: '本县青云山乡', contact: '李青山 13800000001', userId: fu1.id, stabilityScore: 0.93, totalBatches: 2, fulfilledBatches: 2, avgDefectRate: 0.054, aftersalesRate: 0.06 }),
      this.farmers.create({ name: '云岭菌菇合作社', region: '本县云岭镇', contact: '王菌业 13800000002', userId: fu2.id, stabilityScore: 0.9, totalBatches: 1, fulfilledBatches: 1, avgDefectRate: 0.01, aftersalesRate: 0.02 }),
      this.farmers.create({ name: '张记蜜坊', region: '本县桃花坞村', contact: '张蜜坊 13800000003', userId: fu3.id, stabilityScore: 0.97, totalBatches: 1, fulfilledBatches: 1, avgDefectRate: 0, aftersalesRate: 0 }),
      this.farmers.create({ name: '刘记腊味坊', region: '本县老街镇', contact: '刘腊味 13800000004', userId: fu4.id, stabilityScore: 0.66, totalBatches: 1, fulfilledBatches: 1, avgDefectRate: 0.02, aftersalesRate: 0.08 }),
    ]);

    // ---------- 商品 ----------
    const [p1, p2, p3, p4, p5, p6, p7] = await this.products.save([
      this.products.create({ name: '高山红富士苹果', category: '水果', origin: '青云山乡海拔800米果园', spec: '5kg/箱 单果200g+', unit: '箱', shelfLifeDays: 20, coldChainRequired: true, tempZone: '冷藏', packagingType: '泡沫托+纸箱', pressureResistance: '中', description: '高山昼夜温差大，糖度15+', status: 'approved', farmerId: f1.id }),
      this.products.create({ name: '徐香猕猴桃', category: '水果', origin: '青云山乡河谷地', spec: '4.5kg/箱 24枚', unit: '箱', shelfLifeDays: 15, coldChainRequired: true, tempZone: '冷藏', packagingType: '珍珠棉单果包装', pressureResistance: '高', description: '即食型徐香，到手可吃', status: 'approved', farmerId: f1.id }),
      this.products.create({ name: '云岭香菇干', category: '菌菇', origin: '云岭镇椴木基地', spec: '500g/袋', unit: '袋', shelfLifeDays: 180, coldChainRequired: false, tempZone: '常温', packagingType: '自封袋+纸箱', pressureResistance: '高', description: '椴木香菇，肉厚香浓', status: 'approved', farmerId: f2.id }),
      this.products.create({ name: '土蜂蜜', category: '蜂蜜', origin: '桃花坞村蜂场', spec: '500g/瓶 百花蜜', unit: '瓶', shelfLifeDays: 365, coldChainRequired: false, tempZone: '常温', packagingType: '玻璃瓶+气柱袋', pressureResistance: '中', description: '一年一取土蜂蜜', status: 'approved', farmerId: f3.id }),
      this.products.create({ name: '农家腊肠', category: '腊味', origin: '老街镇作坊', spec: '500g/袋', unit: '袋', shelfLifeDays: 90, coldChainRequired: true, tempZone: '冷藏', packagingType: '真空袋+泡沫箱', pressureResistance: '高', description: '传统风干工艺', status: 'approved', farmerId: f4.id }),
      this.products.create({ name: '胚芽大米', category: '米面', origin: '云岭镇稻田', spec: '5kg/袋', unit: '袋', shelfLifeDays: 120, coldChainRequired: false, tempZone: '常温', packagingType: '编织袋', pressureResistance: '高', description: '留胚率80%以上', status: 'submitted', farmerId: f2.id }),
      // 爆单演示商品：赣南脐橙（青山果园）
      this.products.create({ name: '赣南脐橙', category: '水果', origin: '青云山乡向阳坡果园', spec: '5kg/箱 单果75mm+', unit: '箱', shelfLifeDays: 25, coldChainRequired: true, tempZone: '冷藏', packagingType: '网套+泡沫托+纸箱', pressureResistance: '高', description: '现摘现发，糖度13°以上', status: 'approved', farmerId: f1.id }),
    ]);
    const p8 = await this.products.save(
      this.products.create({ name: '赣南脐橙-大果装', category: '水果', origin: '青云山乡向阳坡果园', spec: '4.5kg/箱 18枚 单果85mm+', unit: '箱', shelfLifeDays: 25, coldChainRequired: true, tempZone: '冷藏', packagingType: '网套+泡沫托+纸箱', pressureResistance: '高', description: '大果现货，换规格用', status: 'approved', farmerId: f1.id }),
    );

    // ---------- 批次 ----------
    const [b1, b2, b3, b4, b5, b6] = await this.batches.save([
      this.batches.create({ batchNo: 'B20260920-AP-01', productId: p1.id, quantity: 500, availableQty: 240, soldQty: 260, harvestDate: '2026-09-20', harvestWindowEnd: '2026-10-15', supplyPrice: 28, testReportNo: 'JC-2026-0918', testReportExpiry: '2026-12-31', livestreamAvailable: true, status: 'on_sale', defectRate: 0.054 }),
      this.batches.create({ batchNo: 'B20260928-KW-01', productId: p2.id, quantity: 300, availableQty: 180, soldQty: 120, harvestDate: '2026-09-28', harvestWindowEnd: '2026-10-20', supplyPrice: 35, testReportNo: 'JC-2026-0925', testReportExpiry: '2026-11-30', livestreamAvailable: true, status: 'on_sale', defectRate: 0.01 }),
      this.batches.create({ batchNo: 'B20260915-MU-01', productId: p3.id, quantity: 200, availableQty: 80, soldQty: 0, harvestDate: '2026-09-15', harvestWindowEnd: '2027-03-15', supplyPrice: 22, testReportNo: 'JC-2026-0910', testReportExpiry: '2027-06-30', livestreamAvailable: true, status: 'locked', defectRate: 0 }),
      this.batches.create({ batchNo: 'B20260901-HN-01', productId: p4.id, quantity: 150, availableQty: 150, soldQty: 0, harvestDate: '2026-09-01', harvestWindowEnd: '2027-09-01', supplyPrice: 45, testReportNo: 'JC-2026-0830', testReportExpiry: '2027-09-30', livestreamAvailable: true, status: 'qc_passed', defectRate: 0 }),
      this.batches.create({ batchNo: 'B20260910-LA-01', productId: p5.id, quantity: 200, availableQty: 110, soldQty: 90, harvestDate: '2026-09-10', harvestWindowEnd: '2026-12-10', supplyPrice: 38, testReportNo: 'JC-2026-0903', testReportExpiry: '2026-10-03', livestreamAvailable: true, status: 'closed', defectRate: 0.02 }),
      this.batches.create({ batchNo: 'B20261004-AP-02', productId: p1.id, quantity: 400, availableQty: 400, soldQty: 0, harvestDate: '2026-10-04', harvestWindowEnd: '2026-10-25', supplyPrice: 27, testReportNo: 'JC-2026-1002', testReportExpiry: '2027-01-15', livestreamAvailable: true, status: 'pending', defectRate: 0 }),
    ]);

    // ---------- 橙子爆单批次 ----------
    // b7：L5 爆单场次来源批次（ended）；已质检、300 件售罄
    // b8：追加采摘批次，尚未重新质检（pending）——演示“不能直接混入已锁定批次发货”
    // b9：直播中返场，220 件已质检库存，供现场演示 2 倍爆单分配
    // b10：大果装现货批次（换规格候选）
    // b11：首批追加批次，已重新质检合格并补单 80 笔（演示闭环终态）
    const [b7, b8, b9, b10, b11] = await this.batches.save([
      this.batches.create({ batchNo: 'B20261004-OR-01', productId: p7.id, quantity: 300, availableQty: 0, soldQty: 300, harvestDate: '2026-10-04', harvestWindowEnd: '2026-10-30', supplyPrice: 30, maturityGrade: 5, testReportNo: 'JC-2026-1003', testReportExpiry: '2027-01-20', livestreamAvailable: true, status: 'closed', defectRate: 0.01 }),
      this.batches.create({ batchNo: 'B20261006-OR-SUP2', productId: p7.id, quantity: 220, availableQty: 220, soldQty: 0, harvestDate: '2026-10-06', harvestWindowEnd: '2026-10-31', supplyPrice: 30, maturityGrade: 4, testReportNo: null, testReportExpiry: null, livestreamAvailable: true, status: 'pending', defectRate: 0, isSupplement: true, sourceBatchId: null }),
      this.batches.create({ batchNo: 'B20261006-OR-02', productId: p7.id, quantity: 220, availableQty: 220, soldQty: 0, harvestDate: '2026-10-06', harvestWindowEnd: '2026-10-31', supplyPrice: 30, maturityGrade: 5, testReportNo: 'JC-2026-1005', testReportExpiry: '2027-01-20', livestreamAvailable: true, status: 'qc_passed', defectRate: 0 }),
      this.batches.create({ batchNo: 'B20261005-OR-BIG', productId: p8.id, quantity: 120, availableQty: 120, soldQty: 0, harvestDate: '2026-10-05', harvestWindowEnd: '2026-10-31', supplyPrice: 34, maturityGrade: 5, testReportNo: 'JC-2026-1004', testReportExpiry: '2027-01-20', livestreamAvailable: true, status: 'qc_passed', defectRate: 0 }),
      this.batches.create({ batchNo: 'B20261005-OR-SUP1', productId: p7.id, quantity: 100, availableQty: 20, soldQty: 80, harvestDate: '2026-10-05', harvestWindowEnd: '2026-10-31', supplyPrice: 30, maturityGrade: 5, testReportNo: 'JC-2026-1005', testReportExpiry: '2027-01-20', livestreamAvailable: true, status: 'qc_passed', defectRate: 0, isSupplement: true, sourceBatchId: null }),
    ]);
    // 追加批次来源回填
    b8.sourceBatchId = b7.id;
    b11.sourceBatchId = b7.id;
    await this.batches.save([b8, b11]);

    // ---------- 选品记录 ----------
    await this.selections.save([
      this.selections.create({ batchId: b1.id, operatorId: ops.id, sampleTasteScore: 8, sampleNotes: '脆甜多汁，果面干净', decision: 'selected', notes: '糖度达标，可排播' }),
      this.selections.create({ batchId: b2.id, operatorId: ops.id, sampleTasteScore: 9, sampleNotes: '即食口感好，甜度高', decision: 'selected', notes: '重点推荐' }),
      this.selections.create({ batchId: b3.id, operatorId: ops.id, sampleTasteScore: 7, sampleNotes: '泡发率高，香味足', decision: 'selected', notes: '干货类稳妥' }),
      this.selections.create({ batchId: b4.id, operatorId: ops.id, sampleTasteScore: 8, sampleNotes: '百花蜜结晶细腻', decision: 'selected', notes: '待排期' }),
      this.selections.create({ batchId: b5.id, operatorId: ops.id, sampleTasteScore: 6, sampleNotes: '偏咸，部分肥膘偏多', decision: 'selected', notes: '勉强通过，注意话术' }),
      this.selections.create({ batchId: b7.id, operatorId: ops.id, sampleTasteScore: 9, sampleNotes: '果肉细嫩化渣，酸甜比好', decision: 'selected', notes: '脐橙主推场' }),
      this.selections.create({ batchId: b9.id, operatorId: ops.id, sampleTasteScore: 9, sampleNotes: '糖度14°，果面干净', decision: 'selected', notes: '返场加推' }),
      this.selections.create({ batchId: b10.id, operatorId: ops.id, sampleTasteScore: 9, sampleNotes: '大果现货，适合换规格', decision: 'selected', notes: '换规格备选' }),
      this.selections.create({ batchId: b11.id, operatorId: ops.id, sampleTasteScore: 8, sampleNotes: '追加批次复检：糖度13.5°，农残合格，坏果率1%', decision: 'selected', notes: '追加采摘重新质检通过，可补发货' }),
    ]);

    // ---------- 直播场次 ----------
    const [l1, l2, l3, l4] = await this.livestreams.save([
      this.livestreams.create({ title: '高山苹果开园首发', batchId: b1.id, anchorName: '主播小云', scriptSummary: '果园实景+现摘试吃+糖度实测', promiseText: '现摘现发、坏果包赔、48小时发货', price: 39.9, couponAmount: 5, estimatedSales: 200, actualSales: 260, scheduledAt: new Date('2026-10-01T19:30:00'), status: 'ended', sampleTasteDone: true, createdBy: ops.id }),
      this.livestreams.create({ title: '徐香猕猴桃甜心场', batchId: b2.id, anchorName: '主播阿凯', scriptSummary: '即食对比实验+果园连线', promiseText: '到手即食、坏果包赔', price: 45.9, couponAmount: 6, estimatedSales: 150, actualSales: 120, scheduledAt: new Date('2026-10-05T19:30:00'), status: 'live', sampleTasteDone: true, createdBy: ops.id }),
      this.livestreams.create({ title: '云岭香菇干货节', batchId: b3.id, anchorName: '主播小云', scriptSummary: '泡发现场对比+炖汤演示', promiseText: '椴木香菇、泡发率高', price: 29.9, couponAmount: 3, estimatedSales: 120, actualSales: 0, scheduledAt: new Date('2026-10-08T19:30:00'), status: 'locked', sampleTasteDone: true, createdBy: ops.id }),
      this.livestreams.create({ title: '刘记腊肠年味场', batchId: b5.id, anchorName: '主播大周', scriptSummary: '腊味蒸炒试吃', promiseText: '纯手工无添加、农家土猪肉', price: 59.9, couponAmount: 8, estimatedSales: 100, actualSales: 90, scheduledAt: new Date('2026-09-28T19:30:00'), status: 'ended', sampleTasteDone: true, createdBy: ops.id }),
    ]);

    // ---------- 库存锁定 ----------
    await this.locks.save([
      this.locks.create({ livestreamId: l1.id, batchId: b1.id, lockedQty: 200, packagingMaterial: '泡沫托+纸箱', packagingQty: 220, warehouseName: '县域中心仓', status: 'consumed' }),
      this.locks.create({ livestreamId: l2.id, batchId: b2.id, lockedQty: 150, packagingMaterial: '珍珠棉单果包装', packagingQty: 160, warehouseName: '县域中心仓', status: 'locked' }),
      this.locks.create({ livestreamId: l3.id, batchId: b3.id, lockedQty: 120, packagingMaterial: '自封袋+纸箱', packagingQty: 130, warehouseName: '云岭镇前置仓', status: 'locked' }),
      this.locks.create({ livestreamId: l4.id, batchId: b5.id, lockedQty: 100, packagingMaterial: '真空袋+泡沫箱', packagingQty: 110, warehouseName: '县域中心仓', status: 'consumed' }),
    ]);

    // ---------- 订单（含复购客户） ----------
    // 客户池 400 人：L1 用 0-259，L2 用 180-299（80 人与 L1 重叠=复购），L4 用 310-399（全新客）
    const customers: { name: string; phone: string; city: string }[] = [];
    for (let i = 0; i < 400; i++) {
      customers.push({
        name: SURNAMES[i % SURNAMES.length] + GIVEN[(i * 7) % GIVEN.length],
        phone: `139${String(10000000 + i * 137).slice(0, 8)}`,
        city: CITIES[i % CITIES.length],
      });
    }
    const orders: Partial<Order>[] = [];
    const mk = (ls: Livestream, batch: Batch, idx: number, price: number, coupon: number) => {
      const c = customers[idx % customers.length];
      return this.orders.create({
        orderNo: this.no('O'),
        livestreamId: ls.id,
        batchId: batch.id,
        customerName: c.name,
        phone: c.phone,
        city: c.city,
        address: `${c.city}幸福路${(idx % 200) + 1}号`,
        quantity: 1,
        unitPrice: price,
        amount: Math.max(0, price - coupon),
        status: 'paid',
      });
    };
    // L1 苹果 260 单（客户 0-259）
    for (let i = 0; i < 260; i++) orders.push(mk(l1, b1, i, 39.9, 5));
    // L2 猕猴桃 120 单（客户 180-299 → 180-259 为复购客户）
    for (let i = 0; i < 120; i++) orders.push(mk(l2, b2, 180 + i, 45.9, 6));
    // L4 腊肠 90 单（客户 310-399，全新客）
    for (let i = 0; i < 90; i++) orders.push(mk(l4, b5, 310 + i, 59.9, 8));
    const savedOrders = await this.orders.save(orders as Order[]);
    const l1Orders = savedOrders.filter((o) => o.livestreamId === l1.id);
    const l2Orders = savedOrders.filter((o) => o.livestreamId === l2.id);
    const l4Orders = savedOrders.filter((o) => o.livestreamId === l4.id);
    // 历史订单时间回填
    await this.orders.query('UPDATE orders SET created_at = $1 WHERE livestream_id = $2', ['2026-10-01T20:00:00', l1.id]);
    await this.orders.query('UPDATE orders SET created_at = $1 WHERE livestream_id = $2', ['2026-09-28T20:00:00', l4.id]);

    // ---------- 发货任务 ----------
    const tasks: Partial<ShippingTask>[] = [];
    const mkTask = (o: Order, batch: Batch, product: Product, status: string, vehicleLate = false) =>
      this.tasks.create({
        taskNo: this.no('T'),
        orderId: o.id,
        batchId: batch.id,
        warehouseName: batch.id === b3.id ? '云岭镇前置仓' : '县域中心仓',
        tempZone: product.tempZone,
        carrier: product.coldChainRequired ? '顺丰冷运' : '中通快递',
        coldChainVehicle: product.coldChainRequired ? `冷链车-C${(o.id % 40) + 10}` : null,
        vehicleLate,
        promiseText: '坏果包赔、48小时发货',
        status,
        shippedAt: status !== 'pending' ? new Date('2026-10-02T10:00:00') : null,
        deliveredAt: status === 'delivered' ? new Date('2026-10-03T15:00:00') : null,
      });
    l1Orders.forEach((o, i) => {
      const late = i < 2; // 前两单冷链车晚到
      tasks.push(mkTask(o, b1, p1, i < 240 ? 'delivered' : late ? 'exception' : 'shipped', late));
    });
    l2Orders.forEach((o, i) => tasks.push(mkTask(o, b2, p2, i < 20 ? 'shipped' : 'pending')));
    l4Orders.forEach((o, i) => tasks.push(mkTask(o, b5, p5, i < 80 ? 'delivered' : 'exception')));
    await this.tasks.save(tasks as ShippingTask[]);
    // 订单状态与发货联动
    for (const o of l1Orders.slice(0, 240)) await this.orders.update(o.id, { status: 'delivered' });
    for (const o of l4Orders.slice(0, 80)) await this.orders.update(o.id, { status: 'delivered' });

    // ---------- 售后工单 ----------
    const tickets: Partial<Aftersale>[] = [];
    const mkTicket = (o: Order, batch: Batch, type: string, desc: string, refund: number, status: string) =>
      this.aftersales.create({
        ticketNo: this.no('AS'),
        orderId: o.id,
        batchId: batch.id,
        type,
        description: desc,
        refundAmount: refund,
        status,
        resolution: status === 'resolved' ? '已核实，退款处理完成' : null,
        handledBy: status === 'resolved' ? users[7].id : null,
        resolvedAt: status === 'resolved' ? new Date('2026-10-04T10:00:00') : null,
      });
    // B1 苹果：14 个坏果已解决（14/260=5.4% 触发坏果率预警，其中 2 单来自复购客户）+ 2 待处理 + 物流延误/少发
    for (let i = 0; i < 12; i++) {
      tickets.push(mkTicket(l1Orders[i], b1, '坏果', `到货开箱有${(i % 3) + 1}个烂果，拍照上传`, 15, 'resolved'));
    }
    tickets.push(mkTicket(l1Orders[180], b1, '坏果', '到货有2个烂果', 15, 'resolved'));
    tickets.push(mkTicket(l1Orders[181], b1, '坏果', '箱底果子磕碰腐烂', 15, 'resolved'));
    tickets.push(mkTicket(l1Orders[12], b1, '坏果', '半箱果子磕碰严重', 20, 'pending'));
    tickets.push(mkTicket(l1Orders[13], b1, '坏果', '到货已有霉点', 15, 'pending'));
    tickets.push(mkTicket(l1Orders[14], b1, '物流延误', '冷链车晚到一天，果子发软', 10, 'resolved'));
    tickets.push(mkTicket(l1Orders[15], b1, '少发', '少发1箱', 34.9, 'resolved'));
    // B5 腊肠：口味不符 + 拒收 + 地址错误
    tickets.push(mkTicket(l4Orders[0], b5, '口味不符', '主播说偏甜口，实际很咸', 59.9, 'resolved'));
    tickets.push(mkTicket(l4Orders[1], b5, '口味不符', '肥膘太多，与直播展示不符', 59.9, 'resolved'));
    tickets.push(mkTicket(l4Orders[2], b5, '口味不符', '说是无添加，配料表有亚硝酸钠', 59.9, 'pending'));
    tickets.push(mkTicket(l4Orders[3], b5, '用户拒收', '客户称与直播承诺不一致直接拒收', 59.9, 'resolved'));
    tickets.push(mkTicket(l4Orders[4], b5, '地址错误', '客户搬家地址未更新，需重发', 0, 'resolved'));
    const savedTickets = await this.aftersales.save(tickets as Aftersale[]);
    // 退款订单状态联动
    for (const t of savedTickets) {
      if (t.status === 'resolved' && Number(t.refundAmount) > 0) {
        await this.orders.update(t.orderId, { status: 'refunded' });
      }
    }

    // ---------- 结算 ----------
    const b1Refund = savedTickets
      .filter((t) => t.batchId === b1.id && t.status === 'resolved')
      .reduce((s, t) => s + Number(t.refundAmount), 0);
    const b5Refund = savedTickets
      .filter((t) => t.batchId === b5.id && t.status === 'resolved')
      .reduce((s, t) => s + Number(t.refundAmount), 0);
    await this.settlements.save([
      this.settlements.create({
        farmerId: f1.id, batchId: b1.id, livestreamId: l1.id, orderCount: 260,
        grossAmount: 260 * 28, refundAmount: b1Refund,
        netAmount: 260 * 28 - b1Refund, status: 'pending',
      }),
      this.settlements.create({
        farmerId: f4.id, batchId: b5.id, livestreamId: l4.id, orderCount: 90,
        grossAmount: 90 * 38, refundAmount: b5Refund,
        netAmount: 90 * 38 - b5Refund, status: 'settled', settledAt: new Date('2026-10-03T18:00:00'),
      }),
    ]);

    // ---------- 风险事件 ----------
    await this.risks.save([
      this.risks.create({ type: 'oversell', level: 'warning', batchId: b1.id, livestreamId: l1.id, message: '直播「高山苹果开园首发」实际销量 260 超过预估 200（超出 60 件）', status: 'acknowledged' }),
      this.risks.create({ type: 'defect_rising', level: 'warning', batchId: b1.id, livestreamId: l1.id, message: '批次 B20260920-AP-01 坏果率升至 5.4%（14/260），超过 5% 预警线', status: 'open' }),
      this.risks.create({ type: 'coldchain_late', level: 'warning', batchId: b1.id, livestreamId: l1.id, message: '冷链车 冷链车-C11 晚到 6 小时，2 个发货任务受影响', status: 'open' }),
      this.risks.create({ type: 'report_expired', level: 'critical', batchId: b5.id, livestreamId: null, message: '批次 B20260910-LA-01（农家腊肠）检测报告已于 2026-10-03 过期，批次已收官但仍有售后在处理', status: 'open' }),
      this.risks.create({ type: 'promise_mismatch', level: 'critical', batchId: b5.id, livestreamId: l4.id, message: '直播「刘记腊肠年味场」主播承诺「纯手工无添加」，实际配料含亚硝酸钠，引发多起口味不符售后', status: 'open' }),
      this.risks.create({ type: 'undersupply', level: 'warning', batchId: b2.id, livestreamId: l2.id, message: '批次 B20260928-KW-01 农户通知：连续降雨，明日采摘量预计减少 30%，请关注可售库存', status: 'open' }),
    ]);

    // ---------- 品牌公告 ----------
    await this.notices.save([
      this.notices.create({ title: '关于腊肠批次直播话术的风险说明', content: '9月28日「刘记腊肠年味场」中主播「纯手工无添加」表述与产品实际配料不符。县域公共品牌提醒：各直播间承诺口径须以商品检测报告与配料表为准，不得夸大宣传。', level: 'warning', batchId: b5.id, status: 'published' }),
      this.notices.create({ title: '苹果批次坏果率偏高的情况说明', content: '10月1日苹果专场部分订单出现坏果，已启动坏果包赔。后续场次将下调预售量并加强出库抽检。', level: 'info', batchId: b1.id, status: 'draft' }),
    ]);

    // ---------- 售后反向决策 ----------
    await this.decisions.save([
      this.decisions.create({ aftersaleId: savedTickets[18].id, batchId: b5.id, decisionType: 'adjust_anchor', decision: '腊肠类直播话术去掉「无添加」表述，改为展示配料表实拍', createdBy: users[7].id }),
      this.decisions.create({ aftersaleId: savedTickets[18].id, batchId: b5.id, decisionType: 'drop_farmer', decision: '刘记腊味坊暂停排播一场，待复检报告与整改说明后评估', createdBy: ops.id }),
      this.decisions.create({ aftersaleId: savedTickets[0].id, batchId: b1.id, decisionType: 'reduce_presale', decision: '苹果下一场预售量由 200 下调至 180，并增加出库抽检比例至 10%', createdBy: users[7].id }),
    ]);

    // ============================================================
    // 橙子直播爆单场景（订单超预估两倍 → 库存分配 → 延迟通知 → 追加采摘 → 重新质检 → 补单 → 分层话术）
    // ============================================================
    const [l5, l6] = await this.livestreams.save([
      this.livestreams.create({ title: '赣南脐橙开园爆单场', batchId: b7.id, anchorName: '主播小云', scriptSummary: '果园现场摘果+糖度实测+手剥橙子', promiseText: '现摘现发、坏果包赔、48小时发货', price: 36.9, couponAmount: 5, estimatedSales: 300, actualSales: 600, scheduledAt: new Date('2026-10-04T19:30:00'), status: 'ended', sampleTasteDone: true, createdBy: ops.id }),
      this.livestreams.create({ title: '赣南脐橙返场加推', batchId: b9.id, anchorName: '主播阿凯', scriptSummary: '爆单返场+追加采摘连线', promiseText: '现摘现发、坏果包赔、48小时发货', price: 36.9, couponAmount: 5, estimatedSales: 200, actualSales: 0, scheduledAt: new Date('2026-10-06T19:30:00'), status: 'live', sampleTasteDone: true, createdBy: ops.id }),
    ]);

    await this.locks.save([
      this.locks.create({ livestreamId: l5.id, batchId: b7.id, lockedQty: 300, packagingMaterial: '网套+泡沫托+纸箱', packagingQty: 320, warehouseName: '县域中心仓', status: 'consumed' }),
      this.locks.create({ livestreamId: l6.id, batchId: b9.id, lockedQty: 220, packagingMaterial: '网套+泡沫托+纸箱', packagingQty: 240, warehouseName: '青云山产地仓', status: 'locked' }),
    ]);
    await this.batches.update(b9.id, { status: 'on_sale' });

    const transit: Record<string, number> = {
      杭州市: 1, 上海市: 1, 南京市: 1, 合肥市: 1, 苏州市: 1, 宁波市: 1,
      武汉市: 2, 长沙市: 2, 南昌市: 2, 福州市: 2,
    };
    const baseTime = new Date('2026-10-04T19:30:00').getTime();
    const orangeOrders: Partial<Order>[] = [];
    for (let i = 0; i < 600; i++) {
      const c = customers[i % customers.length];
      orangeOrders.push(
        this.orders.create({
          orderNo: this.no('O'),
          livestreamId: l5.id,
          batchId: b7.id,
          customerName: c.name,
          phone: c.phone,
          city: c.city,
          address: `${c.city}橙香路${(i % 200) + 1}号`,
          quantity: 1,
          unitPrice: 36.9,
          amount: 31.9,
          status:
            i < 240 || (i >= 300 && i < 360) || (i >= 530 && i < 564)
              ? 'delivered'
              : i < 300 || (i >= 360 && i < 380)
                ? 'shipped'
                : i >= 564 && i < 582
                  ? 'refunded'
                  : 'paid',
          fulfillStatus:
            i < 300
              ? 'allocated'
              : i < 380
                ? 'fulfilled'
                : i < 450
                  ? 'waiting'
                  : i < 530
                    ? 'delayed'
                    : i < 564
                      ? 'spec_changed'
                      : 'refund_pending',
        }),
      );
    }
    const savedOrange = await this.orders.save(orangeOrders as Order[]);
    // 付款时间：19:30 起每单间隔 20 秒
    for (let i = 0; i < savedOrange.length; i++) {
      await this.orders.query('UPDATE orders SET created_at = $1 WHERE id = $2', [
        new Date(baseTime + i * 20000).toISOString(),
        savedOrange[i].id,
      ]);
    }

    // 发货任务：源批次发出 / 追加批次复检后补发 / 延迟挂起 / 换规格改发 / 退款取消
    const orangeTasks: Partial<ShippingTask>[] = [];
    const pushTask = (o: Order, batch: Batch, product: Product, status: string, extra: Partial<ShippingTask> = {}) =>
      orangeTasks.push(
        this.tasks.create({
          taskNo: this.no('T'),
          orderId: o.id,
          batchId: batch.id,
          warehouseName: '县域中心仓',
          tempZone: product.tempZone,
          carrier: '顺丰冷运',
          coldChainVehicle: `冷链车-C${(o.id % 40) + 10}`,
          promiseText: '坏果包赔、48小时发货',
          status,
          shippedAt: ['shipped', 'delivered'].includes(status) ? new Date('2026-10-05T10:00:00') : null,
          deliveredAt: status === 'delivered' ? new Date('2026-10-06T15:00:00') : null,
          ...extra,
        }),
      );
    savedOrange.forEach((o, i) => {
      if (i < 300) {
        pushTask(o, b7, p7, i < 240 ? 'delivered' : 'shipped');
      } else if (i < 380) {
        pushTask(o, b11, p7, i < 360 ? 'delivered' : 'shipped', {
          promiseText: '追加批次复检合格补发（B20261005-OR-SUP1）·坏果包赔',
          shippedAt: new Date('2026-10-06T09:00:00'),
          deliveredAt: i < 360 ? new Date('2026-10-07T16:00:00') : null,
        });
      } else if (i < 530) {
        pushTask(o, b7, p7, 'waiting_stock', {
          promiseText: '爆单延迟：待追加采摘批次重新质检合格后补发',
          shippedAt: null,
          deliveredAt: null,
          coldChainVehicle: null,
        });
      } else if (i < 564) {
        pushTask(o, b7, p7, 'cancelled', { promiseText: '用户选择换规格，原规格任务取消', shippedAt: null, deliveredAt: null, coldChainVehicle: null });
        pushTask(o, b10, p8, 'delivered', {
          promiseText: '换规格大果装现货直发·坏果包赔',
          shippedAt: new Date('2026-10-06T09:00:00'),
          deliveredAt: new Date('2026-10-07T15:00:00'),
        });
      } else {
        pushTask(o, b7, p7, 'cancelled', { promiseText: '用户选择退款，任务取消', shippedAt: null, deliveredAt: null, coldChainVehicle: null });
      }
    });
    await this.tasks.save(orangeTasks as ShippingTask[]);

    // 分配记录：300 已分配 + 80 补单已履约 + 220 仍延迟（等待/未决/换规格/退款）
    const allocRecs: Partial<OrderAllocation>[] = [];
    const waitDate = '2026-10-11';
    savedOrange.forEach((o, i) => {
      const days = transit[o.city] ?? 2;
      const payTime = new Date(baseTime + i * 20000);
      if (i < 300) {
        allocRecs.push(this.allocations.create({
          livestreamId: l5.id, orderId: o.id, batchId: b7.id, roundNo: 1, status: 'allocated',
          maturityGrade: 5, maturityNote: '成熟度 5/5，采摘于 2026-10-04，窗口至 2026-10-30',
          logisticsDays: days, onTime: true, payRank: i + 1, score: days * 100 + (600 - i),
          promisedShipAt: new Date(payTime.getTime() + 2 * 86400000),
          eta: new Date(payTime.getTime() + (2 + days) * 86400000),
        }));
      } else if (i < 380) {
        allocRecs.push(this.allocations.create({
          livestreamId: l5.id, orderId: o.id, batchId: b11.id, roundNo: 2, status: 'fulfilled',
          maturityGrade: 5, maturityNote: '成熟度 5/5，追加批次 2026-10-05 重新质检合格（农残合格、坏果率1%）',
          logisticsDays: days, onTime: true, payRank: i + 1, score: days * 100 + (600 - i),
          promisedShipAt: new Date('2026-10-06T09:00:00'),
          eta: new Date(new Date('2026-10-06T09:00:00').getTime() + days * 86400000),
          delayReason: null,
        }));
      } else {
        allocRecs.push(this.allocations.create({
          livestreamId: l5.id, orderId: o.id, batchId: null, roundNo: 1, status: 'delayed',
          logisticsDays: days, onTime: false, payRank: i + 1, score: days * 100 + (600 - i),
          delayReason: '已质检库存 300 件已分完，需等待追加采摘批次重新质检后补发',
          promisedShipAt: new Date(payTime.getTime() + 2 * 86400000),
        }));
      }
    });
    const savedAllocs = await this.allocations.save(allocRecs as OrderAllocation[]);

    // 延迟通知与用户选择：80 等待已补单 / 70 继续等待 / 80 未选择 / 34 换规格 / 36 退款
    const choiceRecs: Partial<DelayChoice>[] = [];
    savedOrange.forEach((o, i) => {
      if (i < 300) return;
      let status = 'notified';
      let specTarget: string | null = null;
      if (i < 450) status = 'wait';
      else if (i < 530) status = 'notified';
      else if (i < 564) {
        status = 'spec_change';
        specTarget = '赣南脐橙-大果装 4.5kg/箱 18枚（单果85mm+）现货';
      } else status = 'refund';
      choiceRecs.push(this.delayChoices.create({
        allocationId: savedAllocs[i].id,
        orderId: o.id,
        livestreamId: l5.id,
        status,
        promisedWaitDate: waitDate,
        specChangeTarget: specTarget,
        refundWaitNote: status === 'refund' ? '退款审核通过后 1-3 个工作日原路退回，最迟不超过 7 个自然日' : null,
        chosenAt: status === 'notified' ? null : new Date('2026-10-05T12:00:00'),
      }));
    });
    await this.delayChoices.save(choiceRecs as DelayChoice[]);

    // 追加采摘任务：第一批 100 件已复检补单；第二批 242 件已交付待复检（对应 pending 追加批次，禁止直接发货）
    await this.harvestTasks.save([
      this.harvestTasks.create({
        taskNo: 'HC20261004-01', productId: p7.id, farmerId: f1.id, livestreamId: l5.id, sourceBatchId: b7.id,
        requiredQty: 100, delayedOrderCount: 300, requiredMaturityGrade: 4,
        qualityRequirements:
          '成熟度≥4/5（八成熟起摘）；糖度≥13°、果径75mm以上；坏果率≤3%；随附7天内农残合格报告；采后24小时内0-4℃冷链入库。追加批次须重新质检合格后方可发货。',
        requiredDeliverAt: new Date('2026-10-06T20:00:00'), status: 'qc_passed', supplementBatchId: b11.id,
        farmerNote: '第一批追加 100 件已交付并复检合格，优先补长途等待订单',
      }),
      this.harvestTasks.create({
        taskNo: 'HC20261005-02', productId: p7.id, farmerId: f1.id, livestreamId: l5.id, sourceBatchId: b7.id,
        requiredQty: 154, delayedOrderCount: 220, requiredMaturityGrade: 4,
        qualityRequirements:
          '成熟度≥4/5（八成熟起摘）；糖度≥13°、果径75mm以上；坏果率≤3%；随附7天内农残合格报告；采后24小时内0-4℃冷链入库。追加批次须重新质检合格后方可发货，不得直接混入已锁定批次。',
        requiredDeliverAt: new Date('2026-10-08T20:00:00'), status: 'delivered', supplementBatchId: b8.id,
        farmerNote: '已加急采摘 242 件入库，农残报告送检中，复检通过前不发货',
      }),
    ]);

    // 客服分层话术（3 类场景 × 3 情绪层级）
    const scriptLevels = [
      { key: 'L1', label: '情绪平稳客户', count: 180 },
      { key: 'L2', label: '催促/抱怨客户', count: 90 },
      { key: 'L3', label: '强烈不满/投诉倾向客户', count: 30 },
    ];
    const scriptTpl: Record<string, Record<string, string>> = {
      delayed_ship: {
        L1: `您好，感谢支持「赣南脐橙开园爆单场」~ 本场订单超预估两倍，平台已按已质检批次、采摘成熟度、物流时效和付款顺序排单。追加批次复检合格后于 ${waitDate} 前发出，随箱附赠高山果品尝鲜装，发货后短信告知单号。`,
        L2: `非常抱歉让您久等！爆单后已质检库存不足，未经质检的追加果品我们不会直接发出——新批次糖度、果径、农残复检通过后按付款先后补发，预计 ${waitDate} 前发出。也可换同价位现货规格（今日发）或全额退款。`,
        L3: `非常抱歉给您不好的体验！为坚守「坏果包赔、48小时发货」承诺，未质检追加批次坚决不发。三方案任选：①${waitDate} 前复检合格优先补发+补偿；②同规格现货今日发；③全额退款 1-3 个工作日退回。我全程跟进。`,
      },
      spec_replace: {
        L1: '您好，原规格需等待追加批次复检。现有同果园「赣南脐橙-大果装 4.5kg/箱 18枚」现货，同一质检标准，今天冷链发出，不另收差价。',
        L2: `理解您想早点收到~ 原规格需等追加批次重新质检（约 ${waitDate}），建议换同价位大果装现货：同片果园、同糖度标准、冷链今日发，重量差异折算赠品补齐。`,
        L3: '非常抱歉！为您安排同果园大果装现货替换：同等质检与坏果包赔标准、今日冷链发出，差价多退少不补并额外补偿；不满意可随时改全额退款。',
      },
      refund_wait: {
        L1: '您好，退款已登记，审核通过后 1-3 个工作日原路退回，最迟不超过 7 个自然日，到账有短信提醒。',
        L2: '抱歉添麻烦了！退款已加急审核，通过后 1-3 个工作日原路退回（银行卡可能稍慢），最迟不超过 7 个自然日，审核通过我主动告知您。',
        L3: '非常抱歉！退款立即走加急通道：今天内审核，1-3 个工作日原路退回；超 7 个自然日未到账平台先行垫付并额外补偿。',
      },
    };
    const scriptRecs: Partial<CsScript>[] = [];
    for (const type of ['delayed_ship', 'spec_replace', 'refund_wait']) {
      for (const lv of scriptLevels) {
        const titleMap: Record<string, string> = {
          delayed_ship: '延迟发货解释话术',
          spec_replace: '规格替换解释话术',
          refund_wait: '退款等待时间解释话术',
        };
        scriptRecs.push(this.csScripts.create({
          livestreamId: l5.id,
          scriptType: type,
          audienceLevel: lv.key,
          audienceLabel: lv.label,
          title: `${titleMap[type]} · ${lv.label}`,
          content: scriptTpl[type][lv.key],
          coveredOrders: lv.count,
        }));
      }
    }
    await this.csScripts.save(scriptRecs as CsScript[]);

    // 爆单延迟风险 + 结算单
    await this.risks.save(
      this.risks.create({
        type: 'allocation_delay', level: 'critical', batchId: b7.id, livestreamId: l5.id,
        message: '直播「赣南脐橙开园爆单场」订单 600 超预估 300 两倍，已质检库存 300 件按成熟度/物流时效/付款时间分配后 300 单延迟；已下达两批追加采摘（第一批复检合格补 80 单，第二批 242 件待复检，严禁混入已锁定批次）',
        status: 'open',
      }),
    );
    await this.settlements.save(
      this.settlements.create({
        farmerId: f1.id, batchId: b7.id, livestreamId: l5.id, orderCount: 600,
        grossAmount: 18000, refundAmount: 1148.4, netAmount: 16851.6, status: 'pending',
      }),
    );
  }
}

@Module({
  imports: [
    TypeOrmModule.forFeature([
      User, Farmer, Product, Batch, Selection, Livestream, InventoryLock,
      Order, ShippingTask, Aftersale, Settlement, RiskEvent, BrandNotice, FeedbackDecision,
      OrderAllocation, HarvestTask, DelayChoice, CsScript,
    ]),
  ],
  providers: [SeedService],
})
export class SeedModule {}
