<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import axios from 'axios'
import { clubIncludesGrade } from '../utils/clubGrades'
import {
  DEFAULT_REGISTRATION_TITLE,
  loadRegistrationTitle,
} from '../utils/registrationSettings'

const router = useRouter()

// 表单数据（姓名、班级由身份证号自动带出）
const form = ref({
  idCard: '',
  name: '',
  className: '',
  clubId: ''
})

// 查询状态
const fetching = ref(false)
const lastQueriedCard = ref('')

const ID_CARD_REGEX = /^\d{17}[\dXx]$/

// 社团列表
const clubs = ref<any[]>([])
const studentGrade = ref<string | null>(null)
const studentLookupComplete = ref(false)
const visibleClubs = computed(() => {
  if (!studentLookupComplete.value || !studentGrade.value) return []
  return clubs.value.filter((club) => clubIncludesGrade(club, studentGrade.value))
})

// 提交状态
const submitting = ref(false)
const registrationTitle = ref(DEFAULT_REGISTRATION_TITLE)

// 报名开放时间
const openAt = ref<string | null>(null)
const now = ref(Date.now())
let timer: number | undefined

const isOpen = computed(() => openAt.value === null || now.value >= new Date(openAt.value).getTime())

// 展示开放时间（浏览器本地时区即 +08:00）
const openTimeText = computed(() => {
  if (openAt.value === null) return ''
  return new Date(openAt.value).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  })
})

// 倒计时文本
const countdownText = computed(() => {
  if (openAt.value === null) return ''
  const diff = new Date(openAt.value).getTime() - now.value
  if (diff <= 0) return ''
  const totalSeconds = Math.floor(diff / 1000)
  const days = Math.floor(totalSeconds / 86400)
  const hours = Math.floor((totalSeconds % 86400) / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  return `距离报名开始还有 ${days} 天 ${hours} 小时 ${minutes} 分 ${seconds} 秒`
})

// 加载开放时间设置
const loadOpenTime = async () => {
  try {
    const response = await axios.get('/api/settings/registration-open-time')
    openAt.value = response.data.data?.openAt ?? null
  } catch (error: any) {
    console.error(error)
  }
}

// 加载社团列表
const loadClubs = async () => {
  try {
    const response = await axios.get('/api/clubs')
    clubs.value = response.data.map((club: any) => ({
      id: club.id,
      name: club.name,
      grade: club.grade,
      grades: club.grades,
      total: club.total_quota,
      remaining: club.remaining_quota
    }))
  } catch (error: any) {
    ElMessage.error('加载社团列表失败')
    console.error(error)
  }
}

// 身份证号变化：清空已带出的姓名/班级；满 18 位自动查询
const handleIdCardInput = async () => {
  const card = form.value.idCard

  if (card !== lastQueriedCard.value) {
    form.value.name = ''
    form.value.className = ''
    form.value.clubId = ''
    studentGrade.value = null
    studentLookupComplete.value = false
    lastQueriedCard.value = ''
  }

  if (!ID_CARD_REGEX.test(card) || fetching.value) return

  fetching.value = true
  lastQueriedCard.value = card
  try {
    const response = await axios.post('/api/students/lookup', { idCard: card })
    if (form.value.idCard !== card) return // 输入已变化，丢弃过期响应
    if (response.data.success && response.data.data) {
      form.value.name = response.data.data.name
      form.value.className = response.data.data.className
      studentGrade.value = response.data.data.grade ?? null
      studentLookupComplete.value = true
      if (!studentGrade.value) {
        ElMessage.warning('学生年级未设置，请联系管理员补全')
      }
    } else {
      studentGrade.value = null
      studentLookupComplete.value = true
      form.value.clubId = ''
      ElMessage.warning(response.data.message || '学生信息不存在，请联系管理员导入')
    }
  } catch (error: any) {
    // 查询失败不清空已带出信息
    ElMessage.error('查询失败，请稍后重试')
    console.error(error)
  } finally {
    fetching.value = false
  }
}

// 提交报名
const handleSubmit = async () => {
  if (!form.value.idCard) {
    ElMessage.warning('请输入身份证号')
    return
  }

  if (!ID_CARD_REGEX.test(form.value.idCard)) {
    ElMessage.warning('身份证号格式不正确')
    return
  }

  if (!form.value.name || !form.value.className) {
    ElMessage.warning('请先输入身份证号查询学生信息')
    return
  }

  if (!studentGrade.value) {
    ElMessage.warning('学生年级未设置，请联系管理员补全')
    return
  }

  if (!form.value.clubId) {
    ElMessage.warning('请选择社团')
    return
  }

  // 验证社团名额
  const selectedClub = visibleClubs.value.find(c => c.id === form.value.clubId)
  if (selectedClub && selectedClub.remaining <= 0) {
    ElMessage.warning('该社团名额已满，请选择其他社团')
    return
  }

  submitting.value = true
  try {
    const response = await axios.post('/api/register', form.value)
    if (response.data.success && response.data.data) {
      const data = response.data.data
      router.push({
        path: '/register/success',
        state: {
          id: data.id,
          name: data.name,
          className: data.className,
          clubName: data.clubName,
          time: data.time,
          idCard: form.value.idCard,
        },
      })
    } else if (response.data.success) {
      // 兼容：成功但无详情数据
      ElMessage.success(response.data.message)
    } else {
      ElMessage.error(response.data.message)
    }
  } catch (error: any) {
    ElMessage.error(error.response?.data?.message || '报名失败')
    console.error(error)
  } finally {
    submitting.value = false
  }
}

// 初始化
onMounted(() => {
  loadClubs()
  loadOpenTime()
  loadRegistrationTitle().then((title) => {
    registrationTitle.value = title
  })
  timer = window.setInterval(() => {
    now.value = Date.now()
  }, 1000)
})

onUnmounted(() => {
  if (timer) window.clearInterval(timer)
})
</script>

<template>
  <div class="register-container">
    <div class="register-card">
      <h1>行知中学</h1>
      <p class="subtitle">{{ registrationTitle }}</p>

      <el-alert
        v-if="!isOpen"
        type="warning"
        :closable="false"
        class="open-time-alert"
      >
        <template #default>
          <div>报名尚未开始，将于 {{ openTimeText }} 开放</div>
          <div v-if="countdownText" class="countdown">{{ countdownText }}</div>
        </template>
      </el-alert>

      <el-form :model="form" label-width="100px" class="register-form" :disabled="!isOpen">
        <el-form-item label="身份证号">
          <el-input 
            v-model="form.idCard" 
            placeholder="请输入18位身份证号"
            maxlength="18"
            clearable
            :loading="fetching"
            @input="handleIdCardInput"
          />
        </el-form-item>

        <el-form-item label="姓名">
          <el-tag v-if="form.name" size="large" class="student-tag">{{ form.name }}</el-tag>
          <span v-else class="tag-placeholder">请输入身份证号后自动带出</span>
        </el-form-item>

        <el-form-item label="班级">
          <el-tag v-if="form.className" size="large" type="info" class="student-tag">{{ form.className }}</el-tag>
          <span v-else class="tag-placeholder">请输入身份证号后自动带出</span>
        </el-form-item>

        <el-form-item label="年级">
          <el-tag v-if="studentGrade" size="large" type="success" class="student-tag">{{ studentGrade }}</el-tag>
          <span v-else class="tag-placeholder">请输入身份证号后自动带出</span>
        </el-form-item>

        <el-alert
          v-if="studentLookupComplete && !studentGrade"
          title="学生年级未设置，请联系管理员补全"
          type="warning"
          :closable="false"
          class="grade-alert"
        />
        <el-alert
          v-else-if="studentLookupComplete && visibleClubs.length === 0"
          title="当前年级暂无可报名社团"
          type="info"
          :closable="false"
          class="grade-alert"
        />

        <el-form-item label="社团">
          <el-select 
            v-model="form.clubId" 
            placeholder="请先输入身份证号查询学生年级"
            style="width: 100%"
            :disabled="!studentGrade"
          >
            <el-option
              v-for="club in visibleClubs"
              :key="club.id"
              :label="`${club.name} (剩余: ${club.remaining}/${club.total})`"
              :value="club.id"
              :disabled="club.remaining === 0"
            />
          </el-select>
        </el-form-item>

        <el-form-item>
          <el-button 
            type="primary" 
            @click="handleSubmit"
            :loading="submitting"
            :disabled="!isOpen"
            style="width: 100%"
          >
            提交报名
          </el-button>
        </el-form-item>
      </el-form>
    </div>
  </div>
</template>

<style scoped>
.register-container {
  min-height: 100vh;
  display: flex;
  justify-content: center;
  align-items: center;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  padding: 20px;
  position: relative;
}

.register-card {
  background: white;
  padding: 40px;
  border-radius: 16px;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.2);
  width: 100%;
  max-width: 500px;
}

.register-card h1 {
  text-align: center;
  margin: 0 0 6px 0;
  color: #303133;
  font-size: 28px;
  font-weight: 700;
}

.register-card .subtitle {
  text-align: center;
  margin: 0 0 30px 0;
  color: #909399;
  font-size: 16px;
}

.register-form {
  width: 100%;
}

.student-tag {
  height: 32px;
  line-height: 30px;
  font-size: 14px;
}

.tag-placeholder {
  color: #a8abb2;
  font-size: 14px;
}

.open-time-alert {
  margin-bottom: 20px;
  text-align: left;
}

.open-time-alert .countdown {
  margin-top: 4px;
  font-weight: 600;
}

.grade-alert {
  margin-bottom: 16px;
  text-align: left;
}
</style>
