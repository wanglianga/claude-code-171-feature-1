import {
  PrimaryGeneratedColumn,
  Column,
  Entity,
  CreateDateColumn,
  Index,
} from 'typeorm';

/**
 * 追加采摘任务：爆单分配出现延迟缺口时，平台向农户下达
 * 含明确数量、成熟度与质量要求；农户交付后生成“追加批次”，
 * 追加批次必须重新选品质检，不能直接混入已锁定批次发货。
 */
@Entity('harvest_tasks')
export class HarvestTask {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @Column({ name: 'product_id' })
  productId: number;

  @Column({ name: 'farmer_id' })
  farmerId: number;

  @Column({ name: 'livestream_id' })
  livestreamId: number;

  /** 缺口来源批次（爆单场次原锁定批次） */
  @Column({ name: 'source_batch_id' })
  sourceBatchId: number;

  @Column({ name: 'task_no', unique: true })
  taskNo: string;

  /** 追加采摘数量（件） */
  @Column('int', { name: 'required_qty' })
  requiredQty: number;

  /** 未满足的延迟订单数 */
  @Column('int', { name: 'delayed_order_count', default: 0 })
  delayedOrderCount: number;

  /** 成熟度要求（1-5，须达到的等级） */
  @Column('int', { name: 'required_maturity_grade' })
  requiredMaturityGrade: number;

  /** 质量要求（糖度、果径、坏果率上限、农残/检测报告要求等） */
  @Column('text', { name: 'quality_requirements' })
  qualityRequirements: string;

  /** 要求交付时间 */
  @Column({ type: 'timestamp', name: 'required_deliver_at' })
  requiredDeliverAt: Date;

  /**
   * issued(已下达) / accepted(农户已接单) / delivered(已交付待质检)
   * qc_passed(追加批次质检通过，可补分配) / qc_failed(质检不合格，退回)
   */
  @Column({ default: 'issued' })
  status: string;

  /** 交付后生成的追加批次 id */
  @Column({ name: 'supplement_batch_id', nullable: true })
  supplementBatchId: number;

  @Column({ name: 'farmer_note', nullable: true })
  farmerNote: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
