<script setup lang="ts">
import { ref, onMounted } from 'vue'
import QRCode from 'qrcode'
import {
  DEFAULT_REGISTRATION_TITLE,
  loadRegistrationTitle,
} from '../utils/registrationSettings'

const qrCodeUrl = ref('')
const registrationTitle = ref(DEFAULT_REGISTRATION_TITLE)

// 生成二维码，指向报名页面
const generateQRCode = async () => {
  try {
    const baseUrl = window.location.origin
    const registerUrl = `${baseUrl}/register`
    qrCodeUrl.value = await QRCode.toDataURL(registerUrl, {
      width: 300,
      margin: 2,
      color: {
        dark: '#303133',
        light: '#ffffff'
      }
    })
  } catch (error) {
    console.error('生成二维码失败:', error)
  }
}

onMounted(async () => {
  registrationTitle.value = await loadRegistrationTitle()
  await generateQRCode()
})
</script>

<template>
  <div class="home-container">
    <div class="qrcode-card">
      <h1>行知中学</h1>
      <p class="subtitle">{{ registrationTitle }}</p>
      <p class="tip">请扫描下方二维码进入报名</p>
      <div class="qrcode-wrapper">
        <img v-if="qrCodeUrl" :src="qrCodeUrl" alt="报名二维码" />
        <div v-else class="loading">加载中...</div>
      </div>
      <p class="hint">使用手机扫描二维码即可报名</p>
    </div>
    
    <!-- 管理员入口 -->
    <div class="admin-link">
      <router-link to="/login">管理员入口</router-link>
    </div>
  </div>
</template>

<style scoped>
.home-container {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  padding: 20px;
}

.qrcode-card {
  background: white;
  padding: 40px 60px;
  border-radius: 16px;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.2);
  text-align: center;
}

.qrcode-card h1 {
  margin: 0 0 6px 0;
  color: #303133;
  font-size: 28px;
  font-weight: 700;
}

.subtitle {
  color: #909399;
  font-size: 16px;
  margin: 0 0 30px 0;
}

.tip {
  color: #909399;
  font-size: 14px;
  margin-bottom: 20px;
}

.qrcode-wrapper {
  display: flex;
  justify-content: center;
  align-items: center;
  width: 300px;
  height: 300px;
  margin: 0 auto;
}

.qrcode-wrapper img {
  width: 100%;
  height: 100%;
}

.loading {
  color: #909399;
  font-size: 14px;
}

.hint {
  margin-top: 20px;
  color: #909399;
  font-size: 14px;
}

.admin-link {
  position: fixed;
  bottom: 20px;
  right: 20px;
}

.admin-link a {
  color: rgba(255, 255, 255, 0.7);
  text-decoration: none;
  font-size: 14px;
  transition: color 0.3s;
}

.admin-link a:hover {
  color: white;
}
</style>
