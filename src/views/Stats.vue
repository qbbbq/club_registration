<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import axios from 'axios'

const router = useRouter()

// 统计数据
const stats = ref<Record<string, any>>({})

// 加载状态
const loading = ref(false)

// 加载统计数据
const loadStats = async () => {
  loading.value = true
  try {
    const response = await axios.get('/api/stats')
    stats.value = response.data
  } catch (error: any) {
    ElMessage.error('获取统计数据失败')
    console.error(error)
  } finally {
    loading.value = false
  }
}

// 返回管理后台
const goBack = () => {
  router.push('/admin')
}

// 初始化
onMounted(() => {
  loadStats()
})
</script>

<template>
  <div class="stats-container">
    <div class="header">
      <el-button @click="goBack" :icon="'ArrowLeft'">返回</el-button>
      <div class="header-title">
        <h1>行知中学</h1>
        <span class="subtitle">社团名额统计</span>
      </div>
      <el-button type="primary" @click="loadStats" :loading="loading" :icon="'Refresh'">
        刷新
      </el-button>
    </div>

    <div class="stats-grid">
      <div 
        v-for="(stat, name) in stats" 
        :key="name"
        class="stat-card"
      >
        <div class="stat-header">
          <h3>{{ name }}</h3>
          <el-tag :type="stat.remaining === 0 ? 'danger' : 'success'" size="small">
            {{ stat.remaining === 0 ? '已满' : '可报名' }}
          </el-tag>
        </div>
        <div class="stat-body">
          <el-progress 
            :percentage="Math.round((stat.registered / stat.total) * 100)"
            :color="stat.remaining === 0 ? '#f56c6c' : '#67c23a'"
            :stroke-width="12"
          />
          <div class="stat-numbers">
            <div class="number-item">
              <span class="label">已报名</span>
              <span class="value">{{ stat.registered }}</span>
            </div>
            <div class="number-item">
              <span class="label">剩余</span>
              <span class="value">{{ stat.remaining }}</span>
            </div>
            <div class="number-item">
              <span class="label">总名额</span>
              <span class="value">{{ stat.total }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.stats-container {
  max-width: 1400px;
  margin: 0 auto;
  padding: 20px;
  min-height: 100vh;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 30px;
}

.header-title {
  display: flex;
  align-items: baseline;
  gap: 10px;
}

.header h1 {
  margin: 0;
  color: #303133;
  font-size: 24px;
  font-weight: 700;
}

.header .subtitle {
  color: #909399;
  font-size: 16px;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 20px;
}

.stat-card {
  background: white;
  border-radius: 12px;
  padding: 20px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.1);
}

.stat-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.stat-header h3 {
  margin: 0;
  color: #303133;
  font-size: 18px;
}

.stat-body {
  display: flex;
  flex-direction: column;
  gap: 15px;
}

.stat-numbers {
  display: flex;
  justify-content: space-around;
  padding-top: 10px;
  border-top: 1px solid #ebeef5;
}

.number-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
}

.number-item .label {
  font-size: 12px;
  color: #909399;
}

.number-item .value {
  font-size: 20px;
  font-weight: bold;
  color: #303133;
}
</style>
