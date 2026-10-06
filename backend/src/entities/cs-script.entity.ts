import {
  PrimaryGeneratedColumn,
  Column,
  Entity,
  CreateDateColumn,
  Index,
} from 'typeorm';

/**
 * 客服分层话术：爆单分配后按延迟订单分层生成
 *  - delayed_ship：解释延迟发货原因、预计补发时间、补偿口径
 *  - spec_replace：解释规格替换方案、差价与品质承诺
 *  - refund_wait：解释退款流程与到账等待时间
 */
@Entity('cs_scripts')
export class CsScript {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @Column({ name: 'livestream_id' })
  livestreamId: number;

  /** delayed_ship / spec_replace / refund_wait */
  @Column({ name: 'script_type' })
  scriptType: string;

  /** 分层：L1 情绪平稳 / L2 催促抱怨 / L3 强烈不满（严重投诉倾向） */
  @Column({ name: 'audience_level' })
  audienceLevel: string;

  @Column({ name: 'audience_label' })
  audienceLabel: string;

  @Column('text')
  title: string;

  @Column('text')
  content: string;

  /** 该层覆盖的延迟订单数 */
  @Column('int', { name: 'covered_orders', default: 0 })
  coveredOrders: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
