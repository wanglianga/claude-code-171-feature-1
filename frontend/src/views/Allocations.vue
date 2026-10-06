<template>
  <div>
    <el-card shadow="never">
      <template #header>
        <div class="head">
          <span>直播爆单库存分配</span>
          <div>
            <el-select v-model="liveId" placeholder="选择直播场次" size="small" style="width: 260px; margin-right: 8px" @change="loadAll">
              <el-option v-for="l in lives" :key="l.id" :value="l.id"
                :label="`${l.title}（销${l.actualSales}/估${l.estimatedSales}·${liveStatus(l.status)}）`" />
            </el-select>
            <el-button v-if="canRun" type="danger" size="small" :loading="running" @click="runAlloc">执行爆单分配</el-button>
            <el-button v-if="canRun" type="success" size="small" :loading="rerunning" @click="rerunAlloc">追加批次复检后补分配</el-button>
          </div>
        </div>
      </template>

      <el-row :gutter="12">
        <el-col :span="4" v-for="c in cards" :key="c.label">
          <el-card shadow="hover" class="kpi" :body-style="{ padding: '14px' }">
            <div class="kpi-num" :style="{ color: c.color }">{{ c.value }}</div>
            <div class="kpi-label">{{ c.label }}</div>
          </el-card>
        </el-col>
      </el-row>
      <el-alert v-if="liveId && summary.delayed > 0" type="error" :closable="false" style="margin-top: 12px">
        <template #title>
          {{ summary.delayed }} 单已进入延迟通知：用户可「等待 / 换规格 / 退款」；追加采摘批次必须重新质检合格后才能补发货，严禁直接混入已锁定批次。
        </template>
      </el-alert>
    </el-card>

    <el-card v-if="liveId && !isFarmer" shadow="never" style="margin-top: 14px">
      <el-tabs v-model="tab">
        <!-- 分配结果 -->
        <el-tab-pane label="分配结果（批次·成熟度·物流·付款序）" name="result">
          <el-table :data="rows" size="small" max-height="560">
            <el-table-column prop="order.orderNo" label="订单号" width="160" />
            <el-table-column label="客户/城市" min-width="130">
              <template #default="{ row }">{{ row.order?.customerName }} · {{ row.order?.city }}</template>
            </el-table-column>
            <el-table-column label="付款序" width="70">
              <template #default="{ row }">#{{ row.payRank }}</template>
            </el-table-column>
            <el-table-column label="物流时效" width="90">
              <template #default="{ row }">
                <el-tag size="small" :type="row.logisticsDays >= 3 ? 'danger' : row.logisticsDays === 2 ? 'warning' : 'success'" effect="plain">{{ row.logisticsDays }}天达</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="采摘成熟度" width="100">
              <template #default="{ row }">
                <span v-if="row.maturityGrade">{{ row.maturityGrade }}/5</span>
                <span v-else class="sub">-</span>
              </template>
            </el-table-column>
            <el-table-column label="分配批次" min-width="150">
              <template #default="{ row }">
                <el-button v-if="row.batchId" link type="primary" size="small" @click="$router.push(`/chain/${row.batchId}`)">{{ row.batch?.batchNo }}</el-button>
                <el-tag v-else size="small" type="danger">待追加批次</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="承诺/预计送达" width="160">
              <template #default="{ row }">
                <div class="sub">发 {{ fmtDate(row.promisedShipAt) }}</div>
                <div class="sub">达 {{ fmtDate(row.eta) || '待定' }}</div>
              </template>
            </el-table-column>
            <el-table-column label="结果" width="100">
              <template #default="{ row }">
                <el-tag size="small" :type="allocTag(row.status)">{{ allocText(row.status) }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="delayReason" label="延迟原因" min-width="180" show-overflow-tooltip />
          </el-table>
        </el-tab-pane>

        <!-- 延迟通知 -->
        <el-tab-pane :label="`延迟通知与用户选择（${delayed.length}）`" name="delay">
          <el-radio-group v-model="delayFilter" size="small" style="margin-bottom: 10px">
            <el-radio-button value="">全部</el-radio-button>
            <el-radio-button value="notified">待用户选择</el-radio-button>
            <el-radio-button value="wait">等待补单</el-radio-button>
            <el-radio-button value="spec_change">换规格</el-radio-button>
            <el-radio-button value="refund">退款</el-radio-button>
          </el-radio-group>
          <el-table :data="filteredDelayed" size="small" max-height="520">
            <el-table-column prop="order.orderNo" label="订单号" width="160" />
            <el-table-column label="客户/城市" min-width="130">
              <template #default="{ row }">{{ row.order?.customerName }} · {{ row.order?.city }} · {{ row.order?.phone }}</template>
            </el-table-column>
            <el-table-column label="承诺等待发货" width="120">
              <template #default="{ row }">{{ row.promisedWaitDate }} 前</template>
            </el-table-column>
            <el-table-column label="用户选择" width="110">
              <template #default="{ row }">
                <el-tag size="small" :type="choiceTag(row.status)">{{ choiceText(row.status) }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="specChangeTarget" label="换规格目标" min-width="180" show-overflow-tooltip />
            <el-table-column prop="refundWaitNote" label="退款等待时长" min-width="180" show-overflow-tooltip />
            <el-table-column label="客服登记" width="240" fixed="right">
              <template #default="{ row }">
                <template v-if="canChoose && ['notified'].includes(row.status)">
                  <el-button size="small" link type="primary" @click="choose(row, 'wait')">继续等待</el-button>
                  <el-button size="small" link type="warning" @click="choose(row, 'spec_change')">换规格</el-button>
                  <el-button size="small" link type="danger" @click="choose(row, 'refund')">退款</el-button>
                </template>
                <span v-else class="sub">已登记</span>
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>

        <!-- 追加采摘任务 -->
        <el-tab-pane :label="`追加采摘任务（${harvest.length}）`" name="harvest">
          <el-alert type="warning" :closable="false" style="margin-bottom: 10px"
            title="铁律：农户追加采摘交付后生成独立追加批次（待质检），必须由运营重新选品质检通过，平台才允许补发货；未质检批次不能混入已锁定批次。" />
          <el-table :data="harvest" size="small">
            <el-table-column prop="taskNo" label="任务号" width="150" />
            <el-table-column label="缺口场次/来源批次" min-width="180">
              <template #default="{ row }">
                <div>{{ liveTitle(row.livestreamId) }}</div>
                <div class="sub">
                  <el-button link type="primary" size="small" @click="$router.push(`/chain/${row.sourceBatchId}`)">来源批次链路</el-button>
                </div>
              </template>
            </el-table-column>
            <el-table-column label="追加数量/延迟单" width="120">
              <template #default="{ row }">{{ row.requiredQty }} 件 / {{ row.delayedOrderCount }} 单</template>
            </el-table-column>
            <el-table-column label="成熟度/质量要求" min-width="260">
              <template #default="{ row }">
                <el-tag size="small" type="warning" effect="plain">成熟度≥{{ row.requiredMaturityGrade }}/5</el-tag>
                <div class="sub" style="white-space: pre-wrap">{{ row.qualityRequirements }}</div>
              </template>
            </el-table-column>
            <el-table-column label="交付期限" width="120">
              <template #default="{ row }">{{ fmtDate(row.requiredDeliverAt) }}</template>
            </el-table-column>
            <el-table-column label="状态/追加批次" width="180">
              <template #default="{ row }">
                <el-tag size="small" :type="harvestTag(row.status)">{{ harvestText(row.status) }}</el-tag>
                <div v-if="row.supplementBatchId" class="sub" style="margin-top: 4px">
                  <el-button link type="primary" size="small" @click="$router.push(`/chain/${row.supplementBatchId}`)">查看追加批次</el-button>
                </div>
                <div v-if="isFarmer && row.farmerNote" class="sub">备注：{{ row.farmerNote }}</div>
              </template>
            </el-table-column>
            <el-table-column v-if="isFarmer || isOperator" label="农户操作" width="180" fixed="right">
              <template #default="{ row }">
                <el-button v-if="isFarmer && row.status === 'issued'" size="small" type="primary" @click="accept(row)">接单</el-button>
                <el-button v-if="isFarmer && ['issued', 'accepted'].includes(row.status)" size="small" type="success" @click="openDeliver(row)">交付追加批次</el-button>
                <el-button v-if="isOperator && row.status === 'delivered'" size="small" type="warning" @click="$router.push('/selections')">去重新质检</el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>

        <!-- 客服分层话术 -->
        <el-tab-pane label="客服分层话术" name="scripts">
          <el-alert type="info" :closable="false" style="margin-bottom: 10px"
            title="按延迟订单客户情绪分三层，分别解释：①延迟发货 ②规格替换 ③退款等待时间。" />
          <el-collapse v-model="activeScripts">
            <el-collapse-item v-for="g in scriptGroups" :key="g.type" :name="g.type">
              <template #title>
                <b>{{ g.label }}</b>
                <span class="sub" style="margin-left: 10px">{{ g.items.length }} 层话术</span>
              </template>
              <div v-for="s in g.items" :key="s.id" class="script-card">
                <div class="script-head">
                  <el-tag size="small" :type="s.audienceLevel === 'L3' ? 'danger' : s.audienceLevel === 'L2' ? 'warning' : 'success'">{{ s.audienceLabel }}</el-tag>
                  <span class="sub">约覆盖 {{ s.coveredOrders }} 单</span>
                  <el-button link type="primary" size="small" @click="copy(s.content)">复制话术</el-button>
                </div>
                <div class="script-body">{{ s.content }}</div>
              </div>
            </el-collapse-item>
          </el-collapse>
        </el-tab-pane>
      </el-tabs>
    </el-card>

    <!-- 农户视图：只看追加采摘任务 -->
    <el-card v-if="liveId && isFarmer" shadow="never" style="margin-top: 14px">
      <template #header><span>我的追加采摘任务（交付后须经平台重新质检）</span></template>
      <el-alert type="warning" :closable="false" style="margin-bottom: 10px"
        title="追加采摘批次交付后状态为「待质检」，复检合格前不能发货，也不能直接混入已锁定批次。" />
      <el-table :data="harvest" size="small">
        <el-table-column prop="taskNo" label="任务号" width="150" />
        <el-table-column label="追加数量/延迟单" width="130">
          <template #default="{ row }">{{ row.requiredQty }} 件 / {{ row.delayedOrderCount }} 单</template>
        </el-table-column>
        <el-table-column label="成熟度/质量要求" min-width="300">
          <template #default="{ row }">
            <el-tag size="small" type="warning" effect="plain">成熟度≥{{ row.requiredMaturityGrade }}/5</el-tag>
            <div class="sub" style="white-space: pre-wrap; margin-top: 4px">{{ row.qualityRequirements }}</div>
          </template>
        </el-table-column>
        <el-table-column label="交付期限" width="110">
          <template #default="{ row }">{{ fmtDate(row.requiredDeliverAt) }}</template>
        </el-table-column>
        <el-table-column label="状态/追加批次" width="170">
          <template #default="{ row }">
            <el-tag size="small" :type="harvestTag(row.status)">{{ harvestText(row.status) }}</el-tag>
            <div v-if="row.supplementBatchId" class="sub" style="margin-top: 4px">
              <el-button link type="primary" size="small" @click="$router.push(`/chain/${row.supplementBatchId}`)">查看追加批次</el-button>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="170" fixed="right">
          <template #default="{ row }">
            <el-button v-if="row.status === 'issued'" size="small" type="primary" @click="accept(row)">接单</el-button>
            <el-button v-if="['issued', 'accepted'].includes(row.status)" size="small" type="success" @click="openDeliver(row)">交付追加批次</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- 农户交付追加批次 -->
    <el-dialog v-model="deliverDlg" title="交付追加采摘批次（须重新质检）" width="520px">
      <el-alert type="error" :closable="false" style="margin-bottom: 12px"
        title="交付后批次状态为「待选品」，运营复检合格前不能发货，也不会混入已锁定批次。" />
      <el-form :model="dForm" label-width="120px">
        <el-form-item label="交付数量(件)" required><el-input-number v-model="dForm.quantity" :min="1" style="width: 100%" /></el-form-item>
        <el-form-item label="采摘日期" required><el-date-picker v-model="dForm.harvestDate" type="date" value-format="YYYY-MM-DD" style="width: 100%" /></el-form-item>
        <el-form-item label="采摘窗口截止" required><el-date-picker v-model="dForm.harvestWindowEnd" type="date" value-format="YYYY-MM-DD" style="width: 100%" /></el-form-item>
        <el-form-item label="成熟度(1-5)" required><el-rate v-model="dForm.maturityGrade" :max="5" /></el-form-item>
        <el-form-item label="检测报告编号"><el-input v-model="dForm.testReportNo" placeholder="复检农残报告编号" /></el-form-item>
        <el-form-item label="报告有效期至"><el-date-picker v-model="dForm.testReportExpiry" type="date" value-format="YYYY-MM-DD" style="width: 100%" /></el-form-item>
        <el-form-item label="交付备注"><el-input v-model="dForm.farmerNote" type="textarea" :rows="2" placeholder="采摘山头、入库冷链温度等" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="deliverDlg = false">取消</el-button>
        <el-button type="success" :loading="saving" @click="doDeliver">确认交付待质检</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import request from '../api/request';
import { useAuthStore } from '../stores/auth';

const auth = useAuthStore();
const route = useRoute();
const isFarmer = computed(() => auth.role === 'farmer');
const isOperator = computed(() => ['operator', 'admin'].includes(auth.role));
const canRun = computed(() => ['operator', 'admin', 'warehouse'].includes(auth.role));
const canChoose = computed(() => ['operator', 'admin', 'aftersales'].includes(auth.role));

const lives = ref([]);
const liveId = ref(null);
const result = ref(null);
const delayed = ref([]);
const harvest = ref([]);
const scripts = ref([]);
const tab = ref('result');
const delayFilter = ref('');
const running = ref(false);
const rerunning = ref(false);
const saving = ref(false);
const deliverDlg = ref(false);
const activeScripts = ref(['delayed_ship']);
const currentTask = ref(null);
const dForm = reactive({ quantity: 100, harvestDate: '', harvestWindowEnd: '', maturityGrade: 4, testReportNo: '', testReportExpiry: '', farmerNote: '' });

const summary = computed(() => result.value || { total: 0, allocated: 0, delayed: 0, fulfilled: 0 });
const rows = computed(() => result.value?.rows || []);
const allCards = computed(() => [
  { key: 'orders', label: '订单总数(实/估)', value: lives.value.find((l) => l.id === liveId.value) ? `${liveActual.value}/${liveEst.value}` : '-', color: '#303133' },
  { key: 'allocated', label: '按时分配', value: summary.value.allocated ?? '-', color: '#67c23a' },
  { key: 'delayed', label: '延迟通知', value: summary.value.delayed ?? '-', color: '#f56c6c' },
  { key: 'fulfilled', label: '追加批次已补单', value: summary.value.fulfilled ?? '-', color: '#409eff' },
  { key: 'pending', label: '延迟单待处理', value: delayed.value.filter((d) => d.status === 'notified').length, color: '#e6a23c' },
  { key: 'harvest', label: '追加采摘任务', value: harvest.value.length, color: '#909399' },
]);
const cards = computed(() =>
  isFarmer.value
    ? allCards.value.filter((c) => ['orders', 'harvest'].includes(c.key))
    : allCards.value,
);
const liveActual = computed(() => lives.value.find((l) => l.id === liveId.value)?.actualSales ?? '-');
const liveEst = computed(() => lives.value.find((l) => l.id === liveId.value)?.estimatedSales ?? '-');

const filteredDelayed = computed(() =>
  delayFilter.value ? delayed.value.filter((d) => d.status === delayFilter.value) : delayed.value,
);
const scriptGroups = computed(() => [
  { type: 'delayed_ship', label: '① 延迟发货解释话术', items: scripts.value.filter((s) => s.scriptType === 'delayed_ship') },
  { type: 'spec_replace', label: '② 规格替换解释话术', items: scripts.value.filter((s) => s.scriptType === 'spec_replace') },
  { type: 'refund_wait', label: '③ 退款等待时间解释话术', items: scripts.value.filter((s) => s.scriptType === 'refund_wait') },
]);

function liveStatus(s) { return { planned: '已排期', locked: '已锁库', live: '直播中', ended: '已结束', cancelled: '已取消' }[s] || s; }
function liveTitle(id) { return lives.value.find((l) => l.id === id)?.title || `场次#${id}`; }
function fmtDate(t) { return t ? String(t).slice(0, 10) : ''; }
function allocText(s) { return { allocated: '已按时分配', delayed: '延迟待补', fulfilled: '追加批次已补' }[s] || s; }
function allocTag(s) { return { allocated: 'success', delayed: 'danger', fulfilled: 'primary' }[s] || 'info'; }
function choiceText(s) { return { notified: '待用户选择', wait: '继续等待', spec_change: '换规格', refund: '申请退款' }[s] || s; }
function choiceTag(s) { return { notified: 'warning', wait: 'primary', spec_change: 'warning', refund: 'danger' }[s] || 'info'; }
function harvestText(s) { return { issued: '已下达待接单', accepted: '农户已接单', delivered: '已交付待质检', qc_passed: '复检合格已补单', qc_failed: '复检不合格' }[s] || s; }
function harvestTag(s) { return { issued: 'info', accepted: 'warning', delivered: 'danger', qc_passed: 'success', qc_failed: 'danger' }[s] || 'info'; }

async function loadLives() {
  lives.value = await request.get('/livestreams');
  const q = Number(route.query.livestream);
  const prefer = q || lives.value.find((l) => l.status === 'live')?.id || lives.value[0]?.id;
  if (prefer) {
    liveId.value = prefer;
    await loadAll();
  }
}

async function loadAll() {
  if (!liveId.value) return;
  harvest.value = await request.get('/allocations/harvest-tasks');
  if (isFarmer.value) {
    result.value = null;
    delayed.value = [];
    scripts.value = [];
    return;
  }
  const [r, d] = await Promise.all([
    request.get(`/allocations/result/${liveId.value}`).catch(() => null),
    request.get('/allocations/delayed', { params: { livestreamId: liveId.value } }).catch(() => []),
  ]);
  result.value = r;
  delayed.value = d;
  scripts.value = await request.get(`/allocations/scripts/${liveId.value}`).catch(() => []);
}

async function runAlloc() {
  await ElMessageBox.confirm('按「已质检批次 → 采摘成熟度 → 物流时效 → 订单付款时间」执行分配？无法 48 小时发货的订单将进入延迟通知，并自动下达追加采摘任务与客服话术。', '执行爆单分配', { type: 'warning' });
  running.value = true;
  try {
    const res = await request.post(`/allocations/run/${liveId.value}`);
    ElMessage.success(`分配完成：按时 ${res.allocated} 单，延迟 ${res.delayed} 单，追加采摘任务已下达`);
    await loadAll();
  } finally { running.value = false; }
}

async function rerunAlloc() {
  await ElMessageBox.confirm('仅使用「已重新质检合格」的追加批次为等待中的延迟订单补发货，未质检批次会被拦截。', '补分配', { type: 'warning' });
  rerunning.value = true;
  try {
    const res = await request.post(`/allocations/rerun/${liveId.value}`);
    ElMessage.success(`补单 ${res.fulfilled} 单，仍延迟 ${res.stillDelayed} 单`);
    await loadAll();
  } finally { rerunning.value = false; }
}

async function choose(row, choice) {
  let specTarget;
  if (choice === 'spec_change') {
    const v = await ElMessageBox.prompt('换规格目标（同果园现货优先）', '用户选择换规格', {
      inputValue: '赣南脐橙-大果装 4.5kg/箱 18枚（单果85mm+）现货',
    });
    specTarget = v.value;
  }
  await request.post(`/allocations/delay/${row.allocation.id}/choose`, { choice, specTarget });
  ElMessage.success(choice === 'wait' ? '已登记继续等待，复检合格后优先补发' : choice === 'spec_change' ? '已登记换规格，现货今日发出' : '已登记退款，1-3 个工作日原路退回');
  await loadAll();
}

function accept(row) {
  return request.post(`/allocations/harvest-tasks/${row.id}/accept`).then(() => {
    ElMessage.success('已接单');
    loadAll();
  });
}

function openDeliver(row) {
  currentTask.value = row;
  Object.assign(dForm, { quantity: row.requiredQty, harvestDate: '', harvestWindowEnd: '', maturityGrade: row.requiredMaturityGrade, testReportNo: '', testReportExpiry: '', farmerNote: '' });
  deliverDlg.value = true;
}

async function doDeliver() {
  if (!dForm.harvestDate || !dForm.harvestWindowEnd) return ElMessage.warning('请填写采摘日期与窗口');
  saving.value = true;
  try {
    await request.post(`/allocations/harvest-tasks/${currentTask.value.id}/deliver`, dForm);
    ElMessage.warning('追加批次已交付，等待运营重新质检');
    deliverDlg.value = false;
    await loadAll();
  } finally { saving.value = false; }
}

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    ElMessage.success('话术已复制');
  } catch {
    ElMessage.info('请手动选择文本复制');
  }
}

onMounted(loadLives);
</script>

<style scoped>
.head { display: flex; justify-content: space-between; align-items: center; }
.kpi-num { font-size: 22px; font-weight: 700; }
.kpi-label { font-size: 12px; color: #909399; margin-top: 2px; }
.sub { font-size: 12px; color: #909399; }
.script-card { border: 1px solid #ebeef5; border-radius: 8px; padding: 10px 12px; margin: 8px 0; }
.script-head { display: flex; align-items: center; gap: 10px; }
.script-body { font-size: 13px; color: #606266; margin-top: 8px; line-height: 1.7; white-space: pre-wrap; }
</style>
