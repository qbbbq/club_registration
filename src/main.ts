import { createApp } from 'vue'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import router from './router'
import './style.css'
import App from './App.vue'
import { registerElementPlusIcons } from './register-icons'

const app = createApp(App)

registerElementPlusIcons(app)

app.use(ElementPlus)
app.use(router)
app.mount('#app')
