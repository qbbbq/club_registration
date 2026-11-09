import axios from 'axios'

export const DEFAULT_REGISTRATION_TITLE = '社团报名系统'

export async function loadRegistrationTitle(): Promise<string> {
  try {
    const response = await axios.get('/api/settings/registration-title')
    const title = response.data?.data?.title
    return typeof title === 'string' && title.trim()
      ? title.trim()
      : DEFAULT_REGISTRATION_TITLE
  } catch (error) {
    console.error('读取报名入口标题失败:', error)
    return DEFAULT_REGISTRATION_TITLE
  }
}
