import {
  PrimaryGeneratedColumn,
  Column,
  Entity,
  CreateDateColumn,
} from 'typeorm';

/**
 * 客服分层话术：爆单分配完成后按场景分层生成——
 * delay(延迟发货解释) / switch(规格替换说明) / refund(退款等待时间)。
 */
@Entity('cs_scripts')
export class CsScript {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'plan_id' })
  planId: number;

  /** delay / switch / refund */
  @Column()
  tier: string;

  @Column()
  title: string;

  @Column('text')
  content: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
