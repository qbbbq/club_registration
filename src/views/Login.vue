<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'

const router = useRouter()

const form = ref({
  username: '',
  password: ''
})

const loading = ref(false)

const handleLogin = async () => {
  if (!form.value.username || !form.value.password) {
    ElMessage.warning('请输入用户名和密码')
    return
  }

  loading.value = true

  // 模拟登录验证（实际项目中应该调用后端API）
  setTimeout(() => {
    if (form.value.username === 'admin' && form.value.password === 'admin') {
      sessionStorage.setItem('isLoggedIn', 'true')
      ElMessage.success('登录成功')
      router.push('/admin')
    } else {
      ElMessage.error('用户名或密码错误')
    }
    loading.value = false
  }, 500)
}

const goBack = () => {
  router.push('/')
}
</script>

<template>
  <div class="login-container">
    <div class="login-card">
      <h2>行知中学</h2>
      <p class="subtitle">后台管理系统</p>
      <p class="login-tip">请输入管理员账号密码登录</p>
      
      <el-form :model="form" label-width="80px" class="login-form">
        <el-form-item label="用户名">
          <el-input 
            v-model="form.username" 
            placeholder="请输入用户名"
            clearable
            @keyup.enter="handleLogin"
          />
        </el-form-item>

        <el-form-item label="密码">
          <el-input 
            v-model="form.password" 
            type="password"
            placeholder="请输入密码"
            show-password
            @keyup.enter="handleLogin"
          />
        </el-form-item>

        <el-form-item>
          <el-button 
            type="primary" 
            @click="handleLogin"
            :loading="loading"
            style="width: 100%"
          >
            登录
          </el-button>
        </el-form-item>

        <el-form-item>
          <el-button 
            @click="goBack"
            style="width: 100%"
          >
            返回报名页面
          </el-button>
        </el-form-item>
      </el-form>
    </div>
  </div>
</template>

<style scoped>
.login-container {
  min-height: 100vh;
  display: flex;
  justify-content: center;
  align-items: center;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
}

.login-card {
  background: white;
  padding: 40px;
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
  width: 400px;
}

.login-card h2 {
  text-align: center;
  margin: 0 0 6px 0;
  color: #303133;
  font-size: 28px;
  font-weight: 700;
}

.login-card .subtitle {
  text-align: center;
  margin: 0 0 10px 0;
  color: #909399;
  font-size: 16px;
}

.login-tip {
  text-align: center;
  color: #909399;
  margin-bottom: 30px;
  font-size: 14px;
}

.login-form {
  width: 100%;
}
</style>
