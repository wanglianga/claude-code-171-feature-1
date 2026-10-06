import {
  PrimaryGeneratedColumn,
  Column,
  Entity,
  CreateDateColumn,
} from 'typeorm';

/**
 * 爆单分配方案 —— 直播销量爆单（超预估）后，平台对库存的一次统一分配。
 * 分配四要素：已质检批次、采摘成熟度、物流时效、订单付款时间。
 */
@Entity('surge_plans')
export class SurgePlan {
  @PrimaryGeneratedColumn()
  id: number;

  /** 一场直播只生成一个分配方案 */
  @Column({ name: 'livestream_id', unique: true })
  livestreamId: number;

  /** 本场主批次 */
  @Column({ name: 'batch_id' })
  batchId: number;

  @Column('int', { name: 'estimated_sales' })
  estimatedSales: number;

  @Column('int', { name: 'actual_sales' })
  actualSales: number;

  /** 爆单倍数（实际/预估） */
  @Column('float', { name: 'oversell_times' })
  oversellTimes: number;

  /** 待分配订单数（已支付未发货） */
  @Column('int', { name: 'order_count' })
  orderCount: number;

  /** 按时发货订单数 */
  @Column('int', { name: 'allocated_count', default: 0 })
  allocatedCount: number;

  /** 进入延迟通知的订单数 */
  @Column('int', { name: 'delayed_count', default: 0 })
  delayedCount: number;

  /** 库存缺口件数（需农户追加采摘） */
  @Column('int', { name: 'shortage_qty', default: 0 })
  shortageQty: number;

  /** executed(已执行分配) / completed(延迟订单全部处理完) */
  @Column({ default: 'executed' })
  status: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
