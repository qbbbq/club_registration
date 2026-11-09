<script setup lang="ts">
import { useRouter } from 'vue-router'

const router = useRouter()

const info = history.state as {
  id?: number
  name?: string
  className?: string
  clubName?: string
  time?: string
  idCard?: string
}
const hasInfo = !!(info?.id && info?.name && info?.className && info?.clubName && info?.time && info?.idCard)

function maskIdCard(idCard: string): string {
  return idCard.length >= 8
    ? idCard.slice(0, 4) + '********' + idCard.slice(-4)
    : idCard
}

function formatTime(time: string): string {
  const d = new Date(time)
  if (isNaN(d.getTime())) return time
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

const goHome = () => {
  router.push('/')
}

const goRegister = () => {
  router.push('/register')
}
</script>

<template>
  <div class="success-container">
    <div class="success-card">
      <h1>行知中学</h1>
      <p class="subtitle">社团报名</p>

      <template v-if="hasInfo">
        <el-result icon="success" title="报名成功" />
        <el-descriptions :column="1" border>
          <el-descriptions-item label="报名编号">#{{ info.id }}</el-descriptions-item>
          <el-descriptions-item label="姓名">{{ info.name }}</el-descriptions-item>
          <el-descriptions-item label="班级">{{ info.className }}</el-descriptions-item>
          <el-descriptions-item label="社团">{{ info.clubName }}</el-descriptions-item>
          <el-descriptions-item label="报名时间">{{ formatTime(info.time!) }}</el-descriptions-item>
          <el-descriptions-item label="身份证号">{{ maskIdCard(info.idCard!) }}</el-descriptions-item>
        </el-descriptions>
        <div class="actions">
          <el-button type="primary" @click="goHome">返回首页</el-button>
          <el-button @click="goRegister">继续报名</el-button>
        </div>
      </template>

      <template v-else>
        <el-result icon="warning" title="无法显示报名信息" />
        <p class="desc">报名信息不存在，请从报名页重新提交</p>
        <div class="actions">
          <el-button type="primary" @click="goHome">返回首页</el-button>
          <el-button type="primary" plain @click="goRegister">去报名</el-button>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.success-container {
  min-height: 100vh;
  display: flex;
  justify-content: center;
  align-items: center;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  padding: 20px;
}

.success-card {
  background: white;
  padding: 40px;
  border-radius: 16px;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.2);
  width: 100%;
  max-width: 500px;
}

.success-card h1 {
  text-align: center;
  margin: 0 0 6px 0;
  color: #303133;
  font-size: 28px;
  font-weight: 700;
}

.success-card .subtitle {
  text-align: center;
  margin: 0 0 30px 0;
  color: #909399;
  font-size: 16px;
}

.actions {
  display: flex;
  justify-content: center;
  margin-top: 30px;
  gap: 12px;
}

.desc {
  text-align: center;
  color: #909399;
}
</style>
