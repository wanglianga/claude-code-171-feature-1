import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { IsInt, IsNotEmpty, IsOptional, Max, Min } from 'class-validator';
import { Selection } from '../../entities/selection.entity';
import { Batch } from '../../entities/batch.entity';
import { HarvestTask } from '../../entities/harvest-task.entity';
import { Roles } from '../../common/decorators';
import { ReqUser } from '../../common/req-user.decorator';

class SelectionDto {
  @IsInt() batchId: number;
  @IsInt() @Min(1) @Max(10) sampleTasteScore: number;
  @IsOptional() sampleNotes?: string;
  @IsNotEmpty() decision: string; // selected / rejected
  @IsOptional() notes?: string;
}

@Injectable()
export class SelectionsService {
  constructor(
    @InjectRepository(Selection) private selections: Repository<Selection>,
    @InjectRepository(Batch) private batches: Repository<Batch>,
    @InjectRepository(HarvestTask) private harvestTasks: Repository<HarvestTask>,
  ) {}

  /** 选品决策：样品试吃评分 + 质检结论，写回批次状态 */
  async decide(dto: SelectionDto, user: any) {
    const batch = await this.batches.findOne({ where: { id: dto.batchId } });
    if (!batch) throw new NotFoundException('批次不存在');
    if (!['selected', 'rejected'].includes(dto.decision)) {
      throw new BadRequestException('决策必须为 selected 或 rejected');
    }
    if (!batch.product || (batch.product as any).status !== 'approved') {
      const withProduct = await this.batches.findOne({
        where: { id: dto.batchId },
      });
      if (withProduct.product && withProduct.product.status !== 'approved') {
        throw new BadRequestException('商品尚未通过运营审核，不能选品');
      }
    }
    const rec = this.selections.create({
      batchId: dto.batchId,
      operatorId: user.sub,
      sampleTasteScore: dto.sampleTasteScore,
      sampleNotes: dto.sampleNotes,
      decision: dto.decision,
      notes: dto.notes,
    });
    const saved = await this.selections.save(rec);
    batch.status = dto.decision === 'selected' ? 'qc_passed' : 'qc_failed';
    await this.batches.save(batch);

    // 追加采摘批次必须重新质检：质检结论回写采摘任务（合格后才能补分配）
    if (batch.isSupplement) {
      await this.harvestTasks.update(
        { supplementBatchId: batch.id },
        { status: dto.decision === 'selected' ? 'qc_passed' : 'qc_failed' },
      );
    }
    return saved;
  }

  async list(query: any) {
    const qb = this.selections
      .createQueryBuilder('s')
      .leftJoinAndMapOne('s.batch', Batch, 'b', 'b.id = s.batch_id')
      .leftJoinAndSelect('b.product', 'p')
      .orderBy('s.id', 'DESC');
    if (query.batchId) qb.andWhere('s.batch_id = :bid', { bid: +query.batchId });
    return qb.getMany();
  }
}

@Controller('selections')
export class SelectionsController {
  constructor(private svc: SelectionsService) {}

  @Post()
  @Roles('operator')
  decide(@Body() dto: SelectionDto, @ReqUser() user: any) {
    return this.svc.decide(dto, user);
  }

  @Get()
  list(@Query() q: any) {
    return this.svc.list(q);
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([Selection, Batch, HarvestTask])],
  controllers: [SelectionsController],
  providers: [SelectionsService],
})
export class SelectionsModule {}
