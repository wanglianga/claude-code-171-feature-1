import {
  PrimaryGeneratedColumn,
  Column,
  Entity,
  CreateDateColumn,
} from 'typeorm';

/** 爆单分配明细：每笔订单的分配结果与依据 */
@Entity('surge_allocations')
export class SurgeAllocation {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'plan_id' })
  planId: number;

  @Column({ name: 'order_id' })
  orderId: number;

  /** 按付款时间排序的分配序号（越小越先分） */
  @Column('int', { name: 'rank_no' })
  rankNo: number;

  @Column('int')
  quantity: number;

  /** allocated(按时发货) / delayed(延迟，进入通知) */
  @Column()
  result: string;

  /** 实际发货来源批次（allocated 时必填） */
  @Column({ name: 'source_batch_id', nullable: true })
  sourceBatchId: number;

  /** 分配/延迟依据说明 */
  @Column('text', { nullable: true })
  reason: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
