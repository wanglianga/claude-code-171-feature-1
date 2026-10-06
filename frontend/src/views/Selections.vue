<template>
  <div>
    <el-card shadow="never">
      <template #header>
        <div class="head">
          <span>待选品批次（样品试吃 + 质检决策）</span>
          <el-button size="small" :icon="Refresh" @click="load">刷新</el-button>
        </div>
      </template>
      <el-table :data="pending" size="small">
        <el-table-column prop="batchNo" label="批次号" width="210">
          <template #default="{ row }">
            {{ row.batchNo }}
            <el-tag v-if="row.isSupplement" size="small" type="danger" effect="dark" style="margin-left: 4px">追加批次·须重新质检</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="商品" min-width="130">
          <template #default="{ row }">{{ row.product?.name }}<div class="sub">{{ row.product?.category }} · {{ row.product?.spec }}</div></template>
        </el-table-column>
        <el-table-column label="农户" width="110">
          <template #default="{ row }">{{ row.product?.farmer?.name }}</template>
        </el-table-column>
        <el-table-column label="供货量" width="80">
          <template #default="{ row }">{{ row.quantity }}件</template>
        </el-table-column>
        <el-table-column prop="harvestDate" label="采摘日期" width="100" />
        <el-table-column label="检测报告" width="140">
          <template #default="{ row }">
            <span :style="{ color: row.reportExpired ? '#f56c6c' : '#303133' }">
              {{ row.testReportNo || '未上传' }}{{ row.reportExpired ? '（已过期）' : '' }}
            </span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="120" fixed="right">
          <template #default="{ row }">
            <el-button size="small" type="primary" @click="openDecide(row)">试吃评审</el-button>
          </template>
        </el-table-column>
        <template #empty><el-empty description="暂无待选品批次" :image-size="60" /></template>
      </el-table>
    </el-card>

    <el-card shadow="never" style="margin-top: 14px">
      <template #header><span>选品记录</span></template>
      <el-table :data="records" size="small">
        <el-table-column prop="id" label="ID" width="60" />
        <el-table-column label="批次" width="160">
          <template #default="{ row }">{{ row.batch?.batchNo }}</template>
        </el-table-column>
        <el-table-column label="商品" min-width="120">
          <template #default="{ row }">{{ row.batch?.product?.name }}</template>
        </el-table-column>
        <el-table-column label="试吃评分" width="100">
          <template #default="{ row }">
            <el-rate :model-value="(row.sampleTasteScore || 0) / 2" disabled size="small" />
            <span class="sub"> {{ row.sampleTasteScore }}/10</span>
          </template>
        </el-table-column>
        <el-table-column prop="sampleNotes" label="试吃笔记" min-width="150" show-overflow-tooltip />
        <el-table-column label="决策" width="90">
          <template #default="{ row }">
            <el-tag size="small" :type="row.decision === 'selected' ? 'success' : 'danger'">{{ row.decision === 'selected' ? '已选品' : '已淘汰' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="notes" label="备注" min-width="120" show-overflow-tooltip />
      </el-table>
    </el-card>

    <el-dialog v-model="dlg" :title="`试吃评审 - ${current?.batchNo || ''}`" width="480px">
      <el-descriptions :column="1" border size="small" style="margin-bottom: 14px">
        <el-descriptions-item label="商品">{{ current?.product?.name }}（{{ current?.product?.spec }}）</el-descriptions-item>
        <el-descriptions-item label="农户">{{ current?.product?.farmer?.name }} · 稳定性 {{ ((current?.product?.farmer?.stabilityScore || 0) * 100).toFixed(0) }}%</el-descriptions-item>
        <el-descriptions-item label="检测报告">{{ current?.testReportNo || '未上传' }}（{{ current?.testReportExpiry || '-' }}）</el-descriptions-item>
      </el-descriptions>
      <el-form label-width="90px">
        <el-form-item label="试吃评分" required>
          <el-rate v-model="form.scoreHalf" :max="5" show-score :score-template="`${form.scoreHalf * 2}/10`" />
        </el-form-item>
        <el-form-item label="试吃笔记"><el-input v-model="form.sampleNotes" type="textarea" :rows="2" placeholder="口感、甜度、新鲜度…" /></el-form-item>
        <el-form-item label="质检备注"><el-input v-model="form.notes" placeholder="报告核验、包装检查…" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button type="danger" plain :loading="saving" @click="decide('rejected')">淘汰</el-button>
        <el-button type="success" :loading="saving" @click="decide('selected')">选品通过</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue';
import { Refresh } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import request from '../api/request';

const pending = ref([]);
const records = ref([]);
const dlg = ref(false);
const saving = ref(false);
const current = ref(null);
const form = reactive({ scoreHalf: 4, sampleNotes: '', notes: '' });

async function load() {
  pending.value = await request.get('/batches', { params: { status: 'pending' } });
  records.value = await request.get('/selections');
}

function openDecide(row) {
  current.value = row;
  form.scoreHalf = 4;
  form.sampleNotes = '';
  form.notes = '';
  dlg.value = true;
}

async function decide(decision) {
  saving.value = true;
  try {
    await request.post('/selections', {
      batchId: current.value.id,
      sampleTasteScore: form.scoreHalf * 2,
      sampleNotes: form.sampleNotes,
      notes: form.notes,
      decision,
    });
    ElMessage.success(decision === 'selected' ? '已选品，批次质检通过' : '已淘汰该批次');
    dlg.value = false;
    load();
  } finally { saving.value = false; }
}

onMounted(load);
</script>

<style scoped>
.head { display: flex; justify-content: space-between; align-items: center; }
.sub { font-size: 12px; color: #909399; }
</style>
