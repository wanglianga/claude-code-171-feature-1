import {
  PrimaryGeneratedColumn,
  Column,
  Entity,
  CreateDateColumn,
} from 'typeorm';

/**
 * 追加采摘任务：爆单缺口下发给农户，
 * 农户提交采摘量后生成独立新批次，必须重新质检合格才可用于发货，
 * 不得直接混入已锁定批次。
 */
@Entity('picking_tasks')
export class PickingTask {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'plan_id' })
  planId: number;

  @Column({ name: 'farmer_id' })
  farmerId: number;

  @Column({ name: 'product_id' })
  productId: number;

  /** 需追加采摘数量（件） */
  @Column('int', { name: 'required_qty' })
  requiredQty: number;

  /** 质量要求（成熟度/糖度/单果重/坏果率等） */
  @Column('text', { name: 'quality_requirements' })
  qualityRequirements: string;

  /** 采摘完成截止（送达仓库复检） */
  @Column({ type: 'date' })
  deadline: string;

  /** assigned(待采摘) / submitted(已提交待质检) / qc_passed / qc_failed */
  @Column({ default: 'assigned' })
  status: string;

  /** 农户实际提交数量 */
  @Column('int', { name: 'submitted_qty', nullable: true })
  submittedQty: number;

  /** 追加采摘生成的独立批次（重新质检前不可用于发货） */
  @Column({ name: 'batch_id', nullable: true })
  batchId: number;

  @Column({ type: 'timestamp', name: 'submitted_at', nullable: true })
  submittedAt: Date;

  /** 质检结论说明 */
  @Column('text', { name: 'qc_note', nullable: true })
  qcNote: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
