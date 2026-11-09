import type { App } from 'vue'
import {
  ArrowLeft,
  Clock,
  DataLine,
  Delete,
  Download,
  Plus,
  Refresh,
  SwitchButton,
  Upload,
} from '@element-plus/icons-vue'

const usedIcons = {
  ArrowLeft,
  Refresh,
  DataLine,
  Download,
  SwitchButton,
  Plus,
  Delete,
  Upload,
  Clock,
}

export function registerElementPlusIcons(app: App): void {
  for (const [name, component] of Object.entries(usedIcons)) {
    app.component(name, component)
  }
}
