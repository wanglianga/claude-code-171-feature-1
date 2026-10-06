import {
  PrimaryGeneratedColumn,
  Column,
  Entity,
  CreateDateColumn,
} from 'typeorm';

/**
 * 延迟发货通知：无法按时发货的订单进入通知队列，
 * 用户可选择 等待(wait) / 换规格(switch) / 退款(refund)。
 */
@Entity('delay_notices')
export class DelayNotice {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'plan_id' })
  planId: number;

  @Column({ name: 'order_id' })
  orderId: number;

  /** 通知文案（发送给用户） */
  @Column('text')
  message: string;

  /** 预计可发货日期 */
  @Column({ type: 'date', name: 'expected_ship_date' })
  expectedShipDate: string;

  /** 延迟原因：stock_shortage(库存不足) / logistics_unreachable(物流时效不可达) */
  @Column({ name: 'delay_reason' })
  delayReason: string;

  /**
   * pending_choice(待用户选择) / waiting(用户选择等待)
   * fulfilled(等待后已补发) / switched(已换规格) / refunded(已退款)
   */
  @Column({ default: 'pending_choice' })
  status: string;

  /** 用户选择：wait/switch/refund */
  @Column({ name: 'user_choice', nullable: true })
  userChoice: string;

  @Column({ type: 'timestamp', name: 'choice_at', nullable: true })
  choiceAt: Date;

  /** 换规格目标批次 */
  @Column({ name: 'switched_to_batch_id', nullable: true })
  switchedToBatchId: number;

  /** 处理结果说明（补发单号/退款金额与时效等） */
  @Column('text', { name: 'resolve_note', nullable: true })
  resolveNote: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
