import {
  PrimaryGeneratedColumn,
  Column,
  Entity,
  CreateDateColumn,
  Index,
} from 'typeorm';

/**
 * 延迟发货通知与用户选择
 * 无法按时发货的订单进入延迟通知，用户可选择：等待 / 换规格 / 退款
 */
@Entity('delay_choices')
export class DelayChoice {
  @PrimaryGeneratedColumn()
  id: number;

  @Index({ unique: true })
  @Column({ name: 'allocation_id' })
  allocationId: number;

  @Column({ name: 'order_id' })
  orderId: number;

  @Column({ name: 'livestream_id' })
  livestreamId: number;

  /**
   * notified(已发送延迟通知，待用户选择)
   * wait(继续等待追加批次) / spec_change(换规格) / refund(申请退款)
   */
  @Column({ default: 'notified' })
  status: string;

  /** 通知中承诺的等待发货预计日期 */
  @Column({ type: 'date', name: 'promised_wait_date', nullable: true })
  promisedWaitDate: string;

  /** 用户选择换规格时的目标商品/规格描述 */
  @Column({ name: 'spec_change_target', nullable: true })
  specChangeTarget: string;

  /** 退款预计到账等待时间说明（如 1-3 个工作日原路退回） */
  @Column({ name: 'refund_wait_note', nullable: true })
  refundWaitNote: string;

  /** 用户选择时间 */
  @Column({ type: 'timestamp', name: 'chosen_at', nullable: true })
  chosenAt: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
