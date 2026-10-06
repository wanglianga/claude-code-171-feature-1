<template>
  <div>
    <!-- 农户视角：追加采摘任务 -->
    <el-card v-if="isFarmer" shadow="never">
      <template #header><span>追加采摘任务（爆单补货）</span></template>
      <el-alert type="warning" :closable="false" style="margin-bottom: 12px"
        title="追加采摘批次独立建档、必须重新质检，复检合格前不得混入已锁定批次发货。" />
      <el-table :data="tasks" size="small" v-loading="loadingTasks">
        <el-table-column label="任务" width="70"><template #default="{ row }">#{{ row.id }}</template></el-table-column>
        <el-table-column prop="livestreamTitle" label="爆单场次" min-width="140" />
        <el-table-column label="商品" min-width="120">
          <template #default="{ row }">{{ row.productName }}<div class="sub">{{ row.spec }}</div></template>
        </el-table-column>
        <el-table-column prop="requiredQty" label="需追加(件)" width="90" />
        <el-table-column prop="deadline" label="采摘截止" width="105" />
        <el-table-column label="质量要求" min-width="260">
          <template #default="{ row }"><span class="sub">{{ row.qualityRequirements }}</span></template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }"><el-tag size="small" :type="taskTag(row.status)">{{ taskText(row.status) }}</el-tag></template>
        </el-table-column>
        <el-table-column label="追加批次" width="150">
          <template #default="{ row }">
            <template v-if="row.batchNo">
              <el-button link type="primary" size="small" @click="$router.push(`/chain/${row.batchId}`)">{{ row.batchNo }}</el-button>
              <div class="sub">{{ row.batchStatus === 'pending' ? '待质检' : row.batchStatus === 'qc_passed' ? '质检合格' : '质检不合格' }}</div>
            </template>
            <span v-else class="sub">—</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="120" fixed="right">
          <template #default="{ row }">
            <el-button v-if="['assigned', 'qc_failed'].includes(row.status)" size="small" type="success" @click="openSubmit(row)">提交采摘</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- 运营/售后视角：爆单分配工作台 -->
    <template v-else>
      <el-card shadow="never" style="margin-bottom: 12px">
        <template #header>
          <div class="head">
            <span>爆单库存分配</span>
            <div v-if="isOperator">
              <el-select v-model="pickedLs" placeholder="选择直播场次" size="small" style="width: 260px; margin-right: 8px" @change="precheck">
                <el-option v-for="l in lives" :key="l.id" :value="l.id"
                  :label="`${l.title}（实${l.actualSales}/估${l.estimatedSales}）`" />
              </el-select>
              <el-button type="danger" size="small" :disabled="!pre || !!pre.existingPlanId" :loading="creating" @click="createPlan">
                生成分配方案
              </el-button>
            </div>
          </div>
        </template>
        <template v-if="pre">
          <el-row :gutter="12" class="stat-row">
            <el-col :span="4"><div class="stat"><div class="num">{{ pre.orderCount }}</div><div class="lbl">待分配订单</div></div></el-col>
            <el-col :span="4"><div class="stat"><div class="num">{{ pre.demandQty }}</div><div class="lbl">需求总件数</div></div></el-col>
            <el-col :span="4"><div class="stat"><div class="num" :style="{ color: pre.poolQty < pre.demandQty ? '#f56c6c' : '#67c23a' }">{{ pre.poolQty }}</div><div class="lbl">已质检可分配库存</div></div></el-col>
            <el-col :span="4"><div class="stat"><div class="num" :style="{ color: pre.unreachableCount ? '#e6a23c' : '#303133' }">{{ pre.unreachableCount }}</div><div class="lbl">冷链不可达订单</div></div></el-col>
            <el-col :span="8">
              <div class="pools">
                <div v-for="p in pre.pools" :key="p.label" class="pool-item">
                  <el-tag size="small" effect="plain">{{ p.batchNo }}</el-tag>
                  {{ p.label }} · {{ p.qty }} 件 · 采摘 {{ p.harvestDate }}
                </div>
                <div v-if="!pre.pools.length" class="sub">无可分配库存池</div>
              </div>
            </el-col>
          </el-row>
          <el-alert v-if="pre.existingPlanId" type="info" :closable="false" style="margin-top: 8px" title="该场次已生成分配方案，见下方方案详情。" />
          <el-alert v-else type="warning" :closable="false" style="margin-top: 8px"
            title="分配规则：仅已质检批次参与 → 采摘早（成熟度高）的批次优先 → 逐单校验物流时效（冷链可达 + 保质期覆盖） → 按订单付款时间先到先得；分不到的订单进入延迟通知。" />
        </template>
        <el-empty v-else-if="isOperator" description="选择场次后显示爆单预检" :image-size="60" />
        <el-empty v-else description="从下方选择方案查看详情" :image-size="60" />
      </el-card>

      <el-card v-if="plan" shadow="never" style="margin-bottom: 12px">
        <template #header>
          <div class="head">
            <span>方案 #{{ plan.id }} · {{ plan.livestreamTitle }}</span>
            <el-tag size="small" :type="plan.status === 'completed' ? 'success' : 'warning'">
              {{ plan.status === 'completed' ? '已收官' : '执行中' }}
            </el-tag>
          </div>
        </template>
        <el-row :gutter="12" class="stat-row">
          <el-col :span="4"><div class="stat"><div class="num" style="color:#f56c6c">{{ plan.oversellTimes }}x</div><div class="lbl">爆单倍数（{{ plan.actualSales }}/{{ plan.estimatedSales }}）</div></div></el-col>
          <el-col :span="4"><div class="stat"><div class="num" style="color:#67c23a">{{ plan.allocatedCount }}</div><div class="lbl">按时发货订单</div></div></el-col>
          <el-col :span="4"><div class="stat"><div class="num" style="color:#e6a23c">{{ plan.delayedCount }}</div><div class="lbl">延迟通知订单</div></div></el-col>
          <el-col :span="4"><div class="stat"><div class="num" style="color:#f56c6c">{{ plan.shortageQty }}</div><div class="lbl">库存缺口(件)</div></div></el-col>
        </el-row>

        <el-tabs v-model="tab" style="margin-top: 8px">
          <el-tab-pane :label="`分配明细（${plan.allocations.length}）`" name="alloc">
            <el-table :data="plan.allocations" size="small" max-height="400">
              <el-table-column prop="rankNo" label="序号" width="60" />
              <el-table-column prop="orderNo" label="订单号" width="160" />
              <el-table-column prop="customerName" label="客户" width="90" />
              <el-table-column prop="city" label="城市" width="90" />
              <el-table-column label="付款时间" width="150">
                <template #default="{ row }">{{ fmtTime(row.paidAt) }}</template>
              </el-table-column>
              <el-table-column prop="quantity" label="件数" width="60" />
              <el-table-column label="结果" width="90">
                <template #default="{ row }">
                  <el-tag size="small" :type="row.result === 'allocated' ? 'success' : 'warning'">
                    {{ row.result === 'allocated' ? '按时发货' : '延迟' }}
                  </el-tag>
                </template>
              </el-table-column>
              <el-table-column label="来源批次 / 依据" min-width="300">
                <template #default="{ row }">
                  <el-tag v-if="row.sourceBatchNo" size="small" effect="plain" style="margin-right: 4px">{{ row.sourceBatchNo }}</el-tag>
                  <span class="sub">{{ row.reason }}</span>
                </template>
              </el-table-column>
            </el-table>
          </el-tab-pane>

          <el-tab-pane :label="`延迟通知（${plan.notices.length}）`" name="notice">
            <el-table :data="plan.notices" size="small" max-height="400">
              <el-table-column prop="orderNo" label="订单号" width="155" />
              <el-table-column prop="customerName" label="客户" width="80" />
              <el-table-column prop="city" label="城市" width="85" />
              <el-table-column label="延迟原因" width="105">
                <template #default="{ row }">
                  <el-tag size="small" :type="row.delayReason === 'stock_shortage' ? 'warning' : 'danger'">
                    {{ row.delayReason === 'stock_shortage' ? '库存不足' : '物流不可达' }}
                  </el-tag>
                </template>
              </el-table-column>
              <el-table-column prop="expectedShipDate" label="预计发货" width="95" />
              <el-table-column label="状态" width="95">
                <template #default="{ row }"><el-tag size="small" :type="noticeTag(row.status)">{{ noticeText(row.status) }}</el-tag></template>
              </el-table-column>
              <el-table-column label="用户选择 / 处理结果" min-width="290">
                <template #default="{ row }">
                  <template v-if="row.status === 'pending_choice'">
                    <el-button size="small" link type="success" @click="choose(row, 'wait')">等待</el-button>
                    <el-button size="small" link type="primary" @click="openSwitch(row)">换规格</el-button>
                    <el-button size="small" link type="danger" @click="choose(row, 'refund')">退款</el-button>
                  </template>
                  <span v-else class="sub">{{ row.resolveNote }}</span>
                </template>
              </el-table-column>
            </el-table>
          </el-tab-pane>

          <el-tab-pane :label="`追加采摘（${plan.pickingTasks.length}）`" name="picking">
            <el-table :data="plan.pickingTasks" size="small">
              <el-table-column label="任务" width="70"><template #default="{ row }">#{{ row.id }}</template></el-table-column>
              <el-table-column prop="requiredQty" label="缺口(件)" width="80" />
              <el-table-column prop="deadline" label="采摘截止" width="105" />
              <el-table-column label="质量要求" min-width="280">
                <template #default="{ row }"><span class="sub">{{ row.qualityRequirements }}</span></template>
              </el-table-column>
              <el-table-column label="状态" width="100">
                <template #default="{ row }"><el-tag size="small" :type="taskTag(row.status)">{{ taskText(row.status) }}</el-tag></template>
              </el-table-column>
              <el-table-column label="追加批次（独立建档·重新质检）" width="180">
                <template #default="{ row }">
                  <el-button v-if="row.batchId" link type="primary" size="small" @click="$router.push(`/chain/${row.batchId}`)">批次 #{{ row.batchId }}</el-button>
                  <span v-else class="sub">待农户提交</span>
                </template>
              </el-table-column>
              <el-table-column label="操作" width="110" fixed="right">
                <template #default="{ row }">
                  <el-button v-if="row.status === 'submitted' && isOperator" size="small" type="warning" @click="openQc(row)">复检</el-button>
                </template>
              </el-table-column>
            </el-table>
          </el-tab-pane>

          <el-tab-pane :label="`客服话术（${plan.scripts.length}）`" name="script">
            <el-row :gutter="12">
              <el-col :span="8" v-for="s in plan.scripts" :key="s.id">
                <el-card shadow="hover" class="script-card">
                  <template #header>
                    <div class="head">
                      <el-tag size="small" :type="{ delay: 'warning', switch: 'primary', refund: 'danger' }[s.tier]">
                        {{ { delay: '延迟发货', switch: '规格替换', refund: '退款' }[s.tier] }}
                      </el-tag>
                      <el-button size="small" link type="primary" @click="copy(s.content)">复制</el-button>
                    </div>
                  </template>
                  <div class="script-title">{{ s.title }}</div>
                  <div class="script-body">{{ s.content }}</div>
                </el-card>
              </el-col>
            </el-row>
          </el-tab-pane>
        </el-tabs>
      </el-card>

      <el-card v-if="plans.length" shadow="never">
        <template #header><span>分配方案列表</span></template>
        <el-table :data="plans" size="small">
          <el-table-column label="方案" width="70"><template #default="{ row }">#{{ row.id }}</template></el-table-column>
          <el-table-column prop="livestreamTitle" label="场次" min-width="150" />
          <el-table-column label="爆单倍数" width="90"><template #default="{ row }"><span style="color:#f56c6c">{{ row.oversellTimes }}x</span></template></el-table-column>
          <el-table-column prop="allocatedCount" label="按时发货" width="80" />
          <el-table-column prop="delayedCount" label="延迟" width="70" />
          <el-table-column prop="shortageQty" label="缺口(件)" width="80" />
          <el-table-column label="状态" width="90">
            <template #default="{ row }"><el-tag size="small" :type="row.status === 'completed' ? 'success' : 'warning'">{{ row.status === 'completed' ? '已收官' : '执行中' }}</el-tag></template>
          </el-table-column>
          <el-table-column label="创建时间" width="150"><template #default="{ row }">{{ fmtTime(row.createdAt) }}</template></el-table-column>
          <el-table-column label="操作" width="90">
            <template #default="{ row }"><el-button size="small" link type="primary" @click="loadPlan(row.id)">查看</el-button></template>
          </el-table-column>
        </el-table>
      </el-card>
    </template>

    <!-- 换规格对话框 -->
    <el-dialog v-model="switchDlg" title="更换现货规格" width="560px">
      <el-alert type="info" :closable="false" style="margin-bottom: 10px"
        title="仅列出同品类、已质检、库存充足且物流可达的批次；差价由平台补贴。" />
      <el-table :data="switchOpts" size="small" v-loading="loadingOpts" highlight-current-row @current-change="(r) => (switchTo = r)">
        <el-table-column prop="productName" label="商品" min-width="110" />
        <el-table-column prop="spec" label="规格" min-width="120" />
        <el-table-column prop="batchNo" label="批次" width="140" />
        <el-table-column prop="availableQty" label="现货" width="60" />
      </el-table>
      <template #footer>
        <el-button @click="switchDlg = false">取消</el-button>
        <el-button type="primary" :disabled="!switchTo" :loading="saving" @click="doSwitch">确认换规格</el-button>
      </template>
    </el-dialog>

    <!-- 农户提交采摘 -->
    <el-dialog v-model="submitDlg" :title="`提交追加采摘 - 任务 #${currentTask?.id || ''}`" width="440px">
      <el-form label-width="90px">
        <el-form-item label="采摘数量"><el-input-number v-model="submitQty" :min="1" style="width: 100%" /></el-form-item>
        <el-form-item label="质量要求"><div class="sub">{{ currentTask?.qualityRequirements }}</div></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="submitDlg = false">取消</el-button>
        <el-button type="success" :loading="saving" @click="doSubmit">提交（生成待质检批次）</el-button>
      </template>
    </el-dialog>

    <!-- 运营复检 -->
    <el-dialog v-model="qcDlg" :title="`追加批次复检 - 任务 #${currentTask?.id || ''}`" width="440px">
      <el-form label-width="90px">
        <el-form-item label="复检结论">
          <el-radio-group v-model="qcResult">
            <el-radio value="pass">合格放行</el-radio>
            <el-radio value="fail">不合格</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="试吃评分"><el-input-number v-model="qcScore" :min="1" :max="10" style="width: 100%" /></el-form-item>
        <el-form-item label="质检说明"><el-input v-model="qcNotes" type="textarea" :rows="2" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="qcDlg = false">取消</el-button>
        <el-button type="warning" :loading="saving" @click="doQc">提交复检</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import request from '../api/request';
import { useAuthStore } from '../stores/auth';

const auth = useAuthStore();
const isFarmer = computed(() => auth.role === 'farmer');
const isOperator = computed(() => ['admin', 'operator'].includes(auth.role));

const lives = ref([]);
const pickedLs = ref(null);
const pre = ref(null);
const plan = ref(null);
const plans = ref([]);
const tasks = ref([]);
const tab = ref('alloc');
const creating = ref(false);
const saving = ref(false);
const loadingTasks = ref(false);

const switchDlg = ref(false);
const switchOpts = ref([]);
const switchTo = ref(null);
const loadingOpts = ref(false);
const currentNotice = ref(null);

const submitDlg = ref(false);
const currentTask = ref(null);
const submitQty = ref(1);

const qcDlg = ref(false);
const qcResult = ref('pass');
const qcScore = ref(8);
const qcNotes = ref('');

function fmtTime(t) { return t ? String(t).replace('T', ' ').slice(0, 16) : ''; }
function taskText(s) {
  return { assigned: '待采摘', submitted: '待复检', qc_passed: '复检合格', qc_failed: '复检不合格' }[s] || s;
}
function taskTag(s) {
  return { assigned: 'warning', submitted: 'primary', qc_passed: 'success', qc_failed: 'danger' }[s] || 'info';
}
function noticeText(s) {
  return { pending_choice: '待用户选择', waiting: '等待补发', fulfilled: '已补发', switched: '已换规格', refunded: '已退款' }[s] || s;
}
function noticeTag(s) {
  return { pending_choice: 'warning', waiting: 'primary', fulfilled: 'success', switched: 'success', refunded: 'danger' }[s] || 'info';
}

async function precheck() {
  pre.value = null;
  if (!pickedLs.value) return;
  pre.value = await request.get(`/surge/precheck/${pickedLs.value}`);
  if (pre.value.existingPlanId) loadPlan(pre.value.existingPlanId);
}

async function createPlan() {
  creating.value = true;
  try {
    plan.value = await request.post('/surge/plans', { livestreamId: pickedLs.value });
    ElMessage.success(`分配完成：按时发货 ${plan.value.allocatedCount} 单，延迟 ${plan.value.delayedCount} 单`);
    tab.value = 'alloc';
    precheck();
    loadPlans();
  } finally { creating.value = false; }
}

async function loadPlan(id) {
  plan.value = await request.get(`/surge/plans/${id}`);
  tab.value = 'alloc';
}

async function loadPlans() {
  plans.value = await request.get('/surge/plans');
}

async function choose(row, choice) {
  if (choice === 'refund') {
    await ElMessageBox.confirm(`确认为订单 ${row.orderNo} 办理全额退款？`, '退款确认', { type: 'warning' });
  }
  await request.post(`/surge/notices/${row.id}/choice`, { choice });
  ElMessage.success('已登记用户选择');
  loadPlan(plan.value.id);
}

async function openSwitch(row) {
  currentNotice.value = row;
  switchTo.value = null;
  switchOpts.value = [];
  switchDlg.value = true;
  loadingOpts.value = true;
  try {
    switchOpts.value = await request.get(`/surge/notices/${row.id}/switch-options`);
  } finally { loadingOpts.value = false; }
}

async function doSwitch() {
  saving.value = true;
  try {
    await request.post(`/surge/notices/${currentNotice.value.id}/choice`, {
      choice: 'switch',
      switchToBatchId: switchTo.value.batchId,
    });
    ElMessage.success('已换规格并生成发货任务');
    switchDlg.value = false;
    loadPlan(plan.value.id);
  } finally { saving.value = false; }
}

async function loadTasks() {
  loadingTasks.value = true;
  try {
    tasks.value = await request.get('/surge/picking-tasks');
  } finally { loadingTasks.value = false; }
}

function openSubmit(row) {
  currentTask.value = row;
  submitQty.value = row.requiredQty;
  submitDlg.value = true;
}

async function doSubmit() {
  saving.value = true;
  try {
    await request.post(`/surge/picking-tasks/${currentTask.value.id}/submit`, { quantity: submitQty.value });
    ElMessage.success('已提交，生成独立待质检批次');
    submitDlg.value = false;
    loadTasks();
  } finally { saving.value = false; }
}

function openQc(row) {
  currentTask.value = row;
  qcResult.value = 'pass';
  qcScore.value = 8;
  qcNotes.value = '';
  qcDlg.value = true;
}

async function doQc() {
  saving.value = true;
  try {
    await request.post(`/surge/picking-tasks/${currentTask.value.id}/qc`, {
      result: qcResult.value,
      score: qcScore.value,
      notes: qcNotes.value,
    });
    ElMessage.success(qcResult.value === 'pass' ? '复检合格，等待中的订单已自动补发' : '已判定不合格');
    qcDlg.value = false;
    loadPlan(plan.value.id);
  } finally { saving.value = false; }
}

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    ElMessage.success('话术已复制');
  } catch {
    ElMessage.info(text.slice(0, 30) + '…');
  }
}

onMounted(async () => {
  if (isFarmer.value) {
    loadTasks();
  } else {
    lives.value = await request.get('/livestreams');
    loadPlans();
    // 默认选中爆单（实际>预估）的场次
    const surged = lives.value
      .filter((l) => l.actualSales > l.estimatedSales && ['live', 'ended'].includes(l.status))
      .sort((a, b) => b.actualSales / b.estimatedSales - a.actualSales / a.estimatedSales)[0];
    if (surged && isOperator.value) {
      pickedLs.value = surged.id;
      precheck();
    }
  }
});
</script>

<style scoped>
.head { display: flex; justify-content: space-between; align-items: center; }
.sub { font-size: 12px; color: #909399; }
.stat-row { margin-bottom: 8px; }
.stat { text-align: center; padding: 8px 0; background: #f8faf7; border-radius: 6px; }
.num { font-size: 22px; font-weight: 700; color: #303133; }
.lbl { font-size: 12px; color: #909399; margin-top: 2px; }
.pools { display: flex; flex-direction: column; gap: 4px; }
.pool-item { font-size: 12px; color: #606266; }
.script-card { min-height: 240px; }
.script-title { font-weight: 600; margin-bottom: 8px; }
.script-body { font-size: 13px; color: #606266; line-height: 1.7; white-space: pre-wrap; }
</style>
