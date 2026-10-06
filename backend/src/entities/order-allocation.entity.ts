import {
  PrimaryGeneratedColumn,
  Column,
  Entity,
  CreateDateColumn,
  Index,
} from 'typeorm';

/**
 * 爆单库存分配结果（一笔订单一条）
 *
 * 分配优先级综合：
 *  - 批次：只分配已质检通过（qc_passed）且在锁库/直播中的批次，按成熟度从高到低
 *  - 采摘成熟度：成熟度等级越高、距最佳食用窗口越近越优先
 *  - 物流时效：订单收货城市距产地越近、温区时效越短越优先
 *  - 订单付款时间：付款越早越优先（先付先发）
 */
@Entity('order_allocations')
export class OrderAllocation {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @Column({ name: 'livestream_id' })
  livestreamId: number;

  @Column({ name: 'order_id' })
  orderId: number;

  /** 分配到的批次；延迟待补单时为 null */
  @Column({ name: 'batch_id', nullable: true })
  batchId: number;

  /** 分配轮次：1=爆单即时分配，2..=追加批次质检通过后的补分配 */
  @Column('int', { name: 'round_no', default: 1 })
  roundNo: number;

  /** allocated(已分配待发货) / delayed(延迟通知待用户选择) / fulfilled(已生成/更新发货任务) */
  @Column({ default: 'allocated' })
  status: string;

  /** 采摘成熟度等级（1-5，5 为最佳食用成熟度） */
  @Column('int', { name: 'maturity_grade', nullable: true })
  maturityGrade: number;

  /** 成熟度评估说明 */
  @Column({ name: 'maturity_note', nullable: true })
  maturityNote: string;

  /** 物流时效（天）：产地仓到收货城市的预计送达天数 */
  @Column('int', { name: 'logistics_days', nullable: true })
  logisticsDays: number;

  /** 能否满足承诺发货时效（如 48 小时发货） */
  @Column({ name: 'on_time', default: true })
  onTime: boolean;

  /** 付款时间序位（同场次内按付款先后，从 1 开始） */
  @Column('int', { name: 'pay_rank', default: 0 })
  payRank: number;

  /** 综合优先级得分（仅用于解释排序，越大越优先） */
  @Column('int', { default: 0 })
  score: number;

  /** 未按时分配的原因 */
  @Column({ name: 'delay_reason', nullable: true })
  delayReason: string;

  /** 承诺最晚发货时间 */
  @Column({ type: 'timestamp', name: 'promised_ship_at', nullable: true })
  promisedShipAt: Date;

  /** 预计最晚送达时间 */
  @Column({ type: 'timestamp', name: 'eta', nullable: true })
  eta: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
