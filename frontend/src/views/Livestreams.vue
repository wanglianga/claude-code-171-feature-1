<template>
  <div>
    <el-card shadow="never">
      <template #header>
        <div class="head">
          <span>直播排期</span>
          <el-button type="success" :icon="Plus" @click="openCreate">新建场次</el-button>
        </div>
      </template>
      <el-table :data="list" size="small" v-loading="loading">
        <el-table-column prop="title" label="场次" min-width="150">
          <template #default="{ row }">
            <div>{{ row.title }}</div>
            <div class="sub">{{ row.anchorName }} · {{ fmtTime(row.scheduledAt) }}</div>
          </template>
        </el-table-column>
        <el-table-column label="批次/商品" min-width="160">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="$router.push(`/chain/${row.batchId}`)">{{ row.batch?.batchNo }}</el-button>
            <div class="sub">{{ row.batch?.product?.name }} · {{ row.batch?.product?.farmer?.name }}</div>
          </template>
        </el-table-column>
        <el-table-column label="价格/券" width="100">
          <template #default="{ row }">¥{{ row.price }}<div class="sub">券 ¥{{ row.couponAmount }}</div></template>
        </el-table-column>
        <el-table-column label="销量(实/估)" width="110">
          <template #default="{ row }">
            <span :style="{ color: row.actualSales > row.estimatedSales ? '#f56c6c' : '#303133' }">{{ row.actualSales }}</span>
            / {{ row.estimatedSales }}
          </template>
        </el-table-column>
        <el-table-column label="状态" width="90">
          <template #default="{ row }">
            <el-tag size="small" :type="tagType(row.status)">{{ statusText(row.status) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="330" fixed="right">
          <template #default="{ row }">
            <el-button size="small" link type="primary" @click="openPrecheck(row)">履约检查</el-button>
            <el-button v-if="row.status === 'planned'" size="small" link type="warning" @click="openLock(row)">锁库</el-button>
            <el-button v-if="['planned', 'locked'].includes(row.status)" size="small" link type="danger" @click="start(row)">开播</el-button>
            <template v-if="row.status === 'live'">
              <el-button size="small" link type="success" @click="simulate(row)">模拟下单</el-button>
              <el-button size="small" link type="warning" @click="end(row)">结束</el-button>
            </template>
            <el-button v-if="['live', 'ended'].includes(row.status)" size="small" type="danger" plain @click="$router.push(`/allocations?livestream=${row.id}`)">爆单分配</el-button>
            <el-button v-if="['live', 'ended'].includes(row.status)" size="small" link type="danger" @click="openMismatch(row)">承诺不符</el-button>
            <el-button v-if="row.status === 'ended'" size="small" link type="success" @click="genSettlement(row)">结算</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- 新建场次 -->
    <el-dialog v-model="createDlg" title="新建直播场次" width="620px">
      <el-form :model="form" label-width="100px">
        <el-form-item label="场次标题" required><el-input v-model="form.title" placeholder="如：高山苹果开园首发" /></el-form-item>
        <el-form-item label="供货批次" required>
          <el-select v-model="form.batchId" style="width: 100%" placeholder="仅质检通过批次" @change="batchChanged">
            <el-option v-for="b in qcBatches" :key="b.id" :value="b.id" :label="`${b.batchNo} · ${b.product?.name}（可售${b.availableQty}件）`" />
          </el-select>
        </el-form-item>
        <el-row :gutter="10">
          <el-col :span="12"><el-form-item label="主播" required><el-input v-model="form.anchorName" /></el-form-item></el-col>
          <el-form-item label="开播时间" required style="width: 100%">
            <el-date-picker v-model="form.scheduledAt" type="datetime" value-format="YYYY-MM-DDTHH:mm:ss" style="width: 100%" @change="batchChanged" />
          </el-form-item>
        </el-row>
        <el-row :gutter="10">
          <el-col :span="8"><el-form-item label="直播价" required><el-input-number v-model="form.price" :min="0.1" :precision="2" style="width: 100%" /></el-form-item></el-col>
          <el-col :span="8"><el-form-item label="优惠券"><el-input-number v-model="form.couponAmount" :min="0" :precision="2" style="width: 100%" /></el-form-item></el-col>
          <el-col :span="8"><el-form-item label="预计销量" required><el-input-number v-model="form.estimatedSales" :min="1" style="width: 100%" /></el-form-item></el-col>
        </el-row>
        <el-form-item label="脚本要点"><el-input v-model="form.scriptSummary" type="textarea" :rows="2" /></el-form-item>
        <el-form-item label="承诺口径"><el-input v-model="form.promiseText" placeholder="如：现摘现发、坏果包赔、48小时发货" /></el-form-item>
        <el-form-item label="样品试吃"><el-switch v-model="form.sampleTasteDone" active-text="已完成" /></el-form-item>
      </el-form>

      <!-- 上架前履约检查 -->
      <template v-if="precheck">
        <el-divider content-position="left">上架前检查：商品承诺 vs 履约能力</el-divider>
        <el-alert :type="precheck.summary.level === 'ok' ? 'success' : precheck.summary.level === 'warn' ? 'warning' : 'error'" :closable="false" style="margin-bottom: 10px">
          <template #title>
            {{ precheck.summary.advice }}　建议预售上限：<b>{{ precheck.summary.suggestedMaxSales }}</b> 件
            <el-button size="small" link type="primary" @click="form.estimatedSales = precheck.summary.suggestedMaxSales">采用</el-button>
          </template>
        </el-alert>
        <div class="check-grid">
          <div v-for="item in precheck.items" :key="item.key" class="check-item" :class="item.status">
            <div class="check-head">
              <el-icon v-if="item.status === 'ok'" color="#67c23a"><CircleCheckFilled /></el-icon>
              <el-icon v-else-if="item.status === 'warn'" color="#e6a23c"><WarningFilled /></el-icon>
              <el-icon v-else color="#f56c6c"><CircleCloseFilled /></el-icon>
              <b>{{ item.label }}</b>
            </div>
            <div class="check-detail">{{ item.detail }}</div>
          </div>
        </div>
      </template>

      <template #footer>
        <el-button @click="createDlg = false">取消</el-button>
        <el-button type="success" :loading="saving" @click="create">创建场次</el-button>
      </template>
    </el-dialog>

    <!-- 锁库 -->
    <el-dialog v-model="lockDlg" :title="`锁定库存 - ${current?.title || ''}`" width="440px">
      <el-form label-width="90px">
        <el-form-item label="锁定数量"><el-input-number v-model="lockForm.lockedQty" :min="1" style="width: 100%" /></el-form-item>
        <el-form-item label="包装材料"><el-select v-model="lockForm.packagingMaterial" style="width: 100%"><el-option v-for="m in ['泡沫托+纸箱', '珍珠棉单果包装', '自封袋+纸箱', '玻璃瓶+气柱袋', '真空袋+泡沫箱', '编织袋']" :key="m" :value="m" :label="m" /></el-select></el-form-item>
        <el-form-item label="包材数量"><el-input-number v-model="lockForm.packagingQty" :min="1" style="width: 100%" /></el-form-item>
        <el-form-item label="发货仓"><el-select v-model="lockForm.warehouseName" style="width: 100%"><el-option v-for="w in ['县域中心仓', '云岭镇前置仓', '青云山产地仓']" :key="w" :value="w" :label="w" /></el-select></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="lockDlg = false">取消</el-button>
        <el-button type="warning" :loading="saving" @click="lock">确认锁定</el-button>
      </template>
    </el-dialog>

    <!-- 承诺不符上报 -->
    <el-dialog v-model="mismatchDlg" title="主播承诺与规格不符上报" width="440px">
      <el-input v-model="mismatchDetail" type="textarea" :rows="3" placeholder="描述主播承诺与实际规格的差异，如：宣称单果250g实际到货180g" />
      <template #footer>
        <el-button @click="mismatchDlg = false">取消</el-button>
        <el-button type="danger" :loading="saving" @click="reportMismatch">上报风险</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue';
import { Plus, CircleCheckFilled, WarningFilled, CircleCloseFilled } from '@element-plus/icons-vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import request from '../api/request';

const list = ref([]);
const qcBatches = ref([]);
const loading = ref(false);
const saving = ref(false);
const createDlg = ref(false);
const lockDlg = ref(false);
const mismatchDlg = ref(false);
const current = ref(null);
const precheck = ref(null);
const mismatchDetail = ref('');

const form = reactive({ title: '', batchId: null, anchorName: '', scheduledAt: '', price: 39.9, couponAmount: 0, estimatedSales: 100, scriptSummary: '', promiseText: '', sampleTasteDone: false });
const lockForm = reactive({ lockedQty: 100, packagingMaterial: '泡沫托+纸箱', packagingQty: 110, warehouseName: '县域中心仓' });

function statusText(s) { return { planned: '已排期', locked: '已锁库', live: '直播中', ended: '已结束', cancelled: '已取消' }[s] || s; }
function tagType(s) { return { planned: 'info', locked: 'warning', live: 'danger', ended: 'success', cancelled: 'info' }[s] || 'info'; }
function fmtTime(t) { return t ? String(t).replace('T', ' ').slice(0, 16) : ''; }

async function load() {
  loading.value = true;
  try {
    list.value = await request.get('/livestreams');
    qcBatches.value = await request.get('/batches', { params: { status: 'qc_passed', available: '1' } });
  } finally { loading.value = false; }
}

function openCreate() {
  precheck.value = null;
  createDlg.value = true;
}

async function batchChanged() {
  if (!form.batchId) return;
  precheck.value = await request.get(`/livestreams/precheck/${form.batchId}`, {
    params: form.scheduledAt ? { scheduledAt: form.scheduledAt } : {},
  });
}

async function openPrecheck(row) {
  const data = await request.get(`/livestreams/precheck/${row.batchId}`, { params: { scheduledAt: row.scheduledAt } });
  Object.assign(form, { batchId: row.batchId, scheduledAt: row.scheduledAt });
  precheck.value = data;
  createDlg.value = true;
}

async function create() {
  if (!form.title || !form.batchId || !form.anchorName || !form.scheduledAt) return ElMessage.warning('请填写标题、批次、主播与开播时间');
  saving.value = true;
  try {
    await request.post('/livestreams', form);
    ElMessage.success('场次已创建');
    createDlg.value = false;
    load();
  } finally { saving.value = false; }
}

function openLock(row) {
  current.value = row;
  lockForm.lockedQty = row.estimatedSales;
  lockForm.packagingQty = Math.ceil(row.estimatedSales * 1.1);
  lockDlg.value = true;
}
async function lock() {
  saving.value = true;
  try {
    await request.post('/inventory/locks', { livestreamId: current.value.id, ...lockForm });
    ElMessage.success('库存与包材已锁定');
    lockDlg.value = false;
    load();
  } finally { saving.value = false; }
}

async function start(row) {
  await request.post(`/livestreams/${row.id}/start`);
  ElMessage.success('已开播');
  load();
}

async function end(row) {
  await ElMessageBox.confirm(`结束「${row.title}」？将按实际销量 ${row.actualSales} 进入结算流程`, '结束直播', { type: 'warning' });
  await request.post(`/livestreams/${row.id}/end`);
  ElMessage.success('直播已结束');
  load();
}

async function simulate(row) {
  const { value } = await ElMessageBox.prompt('模拟下单数量', '模拟直播爆单', { inputValue: '20', inputPattern: /^\d+$/, inputErrorMessage: '请输入数字' });
  const res = await request.post(`/orders/simulate/${row.id}`, { count: +value });
  ElMessage.success(`已生成 ${res.created} 笔订单并自动创建发货任务`);
  load();
}

function openMismatch(row) {
  current.value = row;
  mismatchDetail.value = '';
  mismatchDlg.value = true;
}
async function reportMismatch() {
  if (!mismatchDetail.value) return ElMessage.warning('请描述差异');
  saving.value = true;
  try {
    await request.post(`/livestreams/${current.value.id}/promise-mismatch`, { detail: mismatchDetail.value });
    ElMessage.warning('承诺不符风险已上报');
    mismatchDlg.value = false;
  } finally { saving.value = false; }
}

async function genSettlement(row) {
  try {
    const s = await request.post(`/settlements/generate/${row.id}`);
    ElMessage.success(`结算单已生成：农户实收 ¥${s.netAmount}`);
  } catch { /* 拦截器已提示 */ }
}

onMounted(load);
</script>

<style scoped>
.head { display: flex; justify-content: space-between; align-items: center; }
.sub { font-size: 12px; color: #909399; }
.check-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.check-item { border: 1px solid #ebeef5; border-radius: 8px; padding: 8px 10px; }
.check-item.ok { border-left: 3px solid #67c23a; }
.check-item.warn { border-left: 3px solid #e6a23c; }
.check-item.bad { border-left: 3px solid #f56c6c; }
.check-head { display: flex; align-items: center; gap: 6px; font-size: 13px; }
.check-detail { font-size: 12px; color: #606266; margin-top: 4px; line-height: 1.5; }
</style>
