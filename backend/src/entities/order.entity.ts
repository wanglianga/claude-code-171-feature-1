import {
  PrimaryGeneratedColumn,
  Column,
  Entity,
  CreateDateColumn,
} from 'typeorm';

@Entity('orders')
export class Order {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'order_no', unique: true })
  orderNo: string;

  @Column({ name: 'livestream_id' })
  livestreamId: number;

  @Column({ name: 'batch_id' })
  batchId: number;

  @Column({ name: 'customer_name' })
  customerName: string;

  @Column()
  phone: string;

  @Column()
  city: string;

  @Column()
  address: string;

  @Column('int')
  quantity: number;

  @Column('decimal', { name: 'unit_price', precision: 10, scale: 2 })
  unitPrice: number;

  @Column('decimal', { precision: 10, scale: 2 })
  amount: number;

  /** paid/shipped/delivered/completed/refunded */
  @Column({ default: 'paid' })
  status: string;

  /**
   * 爆单分配履约标记（普通订单为空）：
   * allocated(已按时分配) / delayed(延迟通知中) / waiting(用户选择等待补单)
   * spec_changed(已换规格) / refund_pending(退款处理中) / fulfilled(追加批次补单已排发货)
   */
  @Column({ name: 'fulfill_status', nullable: true })
  fulfillStatus: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
