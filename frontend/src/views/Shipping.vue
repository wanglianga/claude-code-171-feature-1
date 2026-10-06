<template>
  <div>
    <el-card shadow="never">
      <template #header>
        <div class="head">
          <span>发货任务（按订单·批次·仓库·温区·承诺生成）</span>
          <el-radio-group v-model="filter" size="small" @change="load">
            <el-radio-button value="">全部</el-radio-button>
            <el-radio-button value="pending">待发货</el-radio-button>
            <el-radio-button value="waiting_stock">等待补库</el-radio-button>
            <el-radio-button value="shipped">已发货</el-radio-button>
            <el-radio-button value="delivered">已送达</el-radio-button>
            <el-radio-button value="exception">异常</el-radio-button>
          </el-radio-group>
        </div>
      </template>
      <el-table :data="list" size="small" v-loading="loading" max-height="620">
        <el-table-column prop="taskNo" label="任务号" width="160" />
        <el-table-column label="订单/客户" min-width="130">
          <template #default="{ row }">
            <div>{{ row.order?.orderNo }}</div>
            <div class="sub">{{ row.order?.customerName }} · {{ row.order?.city }}</div>
          </template>
        </el-table-column>
        <el-table-column prop="warehouseName" label="发货仓" width="110" />
        <el-table-column label="温区" width="80">
          <template #default="{ row }">
            <el-tag size="small" :type="row.tempZone === '常温' ? 'info' : row.tempZone === '冷藏' ? 'primary' : 'warning'" effect="plain">{{ row.tempZone }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="承运/车辆" min-width="130">
          <template #default="{ row }">
            <div>{{ row.carrier }}</div>
            <div class="sub" :style="{ color: row.vehicleLate ? '#f56c6c' : '#909399' }">
              {{ row.coldChainVehicle || '普通货运' }}{{ row.vehicleLate ? '（晚到）' : '' }}
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="promiseText" label="随单承诺" min-width="140" show-overflow-tooltip />
        <el-table-column label="状态" width="90">
          <template #default="{ row }">
            <el-tag size="small" :type="{ pending: 'warning', waiting_stock: 'danger', cancelled: 'info', shipped: 'primary', in_transit: 'primary', delivered: 'success', exception: 'danger' }[row.status]">
              {{ { pending: '待发货', waiting_stock: '等待补库(延迟)', cancelled: '已取消', shipped: '已发货', in_transit: '运输中', delivered: '已送达', exception: '异常' }[row.status] }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="200" fixed="right">
          <template #default="{ row }">
            <el-button v-if="row.status === 'pending'" size="small" link type="primary" @click="act(row, 'ship')">发货</el-button>
            <el-button v-if="['shipped', 'in_transit'].includes(row.status)" size="small" link type="success" @click="act(row, 'deliver')">送达</el-button>
            <el-button v-if="row.coldChainVehicle && !row.vehicleLate && ['pending', 'shipped'].includes(row.status)" size="small" link type="warning" @click="late(row)">冷链晚到</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import request from '../api/request';

const list = ref([]);
const filter = ref('');
const loading = ref(false);

async function load() {
  loading.value = true;
  try {
    list.value = await request.get('/shipping/tasks', { params: filter.value ? { status: filter.value } : {} });
  } finally { loading.value = false; }
}

async function act(row, action) {
  await request.post(`/shipping/tasks/${row.id}/${action}`);
  ElMessage.success(action === 'ship' ? '已发货' : '已送达');
  load();
}

async function late(row) {
  const { value } = await ElMessageBox.prompt('晚到原因（如高速管制、车辆故障）', '冷链车晚到上报', { inputValue: '高速临时管制' });
  await request.post(`/shipping/tasks/${row.id}/vehicle-late`, { note: value });
  ElMessage.warning('已上报，链路风险事件已生成');
  load();
}

onMounted(load);
</script>

<style scoped>
.head { display: flex; justify-content: space-between; align-items: center; }
.sub { font-size: 12px; color: #909399; }
</style>
