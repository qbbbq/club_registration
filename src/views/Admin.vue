<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import axios from 'axios'
import { getRawFile } from '../utils/uploadFile'
import { parseClubGrades } from '../utils/clubGrades'
import { DEFAULT_REGISTRATION_TITLE } from '../utils/registrationSettings'
import {
  filterStudentRegistrationClubs,
  isStudentRegistrationClubDisabled as isClubDisabled,
  resetUnregisteredClubForGrade,
  shouldPreserveStudentRegistrationResult,
  studentRegistrationFormFromRecord,
  studentRegistrationSaveWasRefreshedSuccessfully,
} from '../utils/studentRegistrationForm'

const router = useRouter()
const GRADE_OPTIONS = ['初一', '初二', '初三']

// 社团列表
const clubs = ref<any[]>([])

// 报名记录
const registrations = ref<any[]>([])

// 学生列表
const students = ref<any[]>([])

// 加载状态
const loading = ref(false)

// 编辑对话框
const editDialogVisible = ref(false)
const editForm = ref({
  id: 0,
  name: '',
  grades: [] as string[],
  total_quota: 50,
  manager: '',
  manager_contact: ''
})

// 新增社团对话框
const addDialogVisible = ref(false)
const addForm = ref({
  name: '',
  description: '',
  grades: [] as string[],
  total_quota: 50,
  manager: '',
  manager_contact: ''
})

// 导入学生对话框
const importDialogVisible = ref(false)
const importLoading = ref(false)
const selectedFile = ref<File | null>(null)
const importResult = ref<{ successCount: number; skipCount: number; errors: string[] } | null>(null)

// 导入社团对话框
const clubImportDialogVisible = ref(false)
const clubImportLoading = ref(false)
const selectedClubFile = ref<File | null>(null)
const clubImportResult = ref<{
  createdCount: number
  updatedCount: number
  skipCount: number
  errors: string[]
} | null>(null)

interface StudentRegistrationRecord {
  student: {
    id: number
    name: string
    idCard: string
    grade: string | null
    className: string
  }
  registration: {
    id: number
    clubId: number
    clubName: string
    time: string
  } | null
}

const studentRegistrationSearchIdCard = ref('')
const studentRegistrationRecord = ref<StudentRegistrationRecord | null>(null)
const studentRegistrationLoading = ref(false)
const studentRegistrationSaving = ref(false)
let studentRegistrationLookupSequence = 0
let studentRegistrationLookupController: AbortController | null = null
const studentRegistrationForm = ref({
  idCard: '',
  name: '',
  grade: '',
  className: '',
  clubId: null as number | null
})

const currentStudentRegistration = computed(
  () => studentRegistrationRecord.value?.registration ?? null
)

const isStudentRegistrationFormDirty = computed(() => {
  const record = studentRegistrationRecord.value
  if (!record) return false

  return shouldPreserveStudentRegistrationResult(
    studentRegistrationFormFromRecord(record),
    studentRegistrationForm.value
  )
})

const studentRegistrationClubs = computed(() => {
  return filterStudentRegistrationClubs(
    clubs.value,
    studentRegistrationForm.value.grade,
    currentStudentRegistration.value
  )
})

const isStudentRegistrationClubDisabled = (club: any) => {
  return isClubDisabled(
    club,
    studentRegistrationForm.value.grade,
    currentStudentRegistration.value
  )
}

const handleStudentRegistrationGradeChange = () => {
  studentRegistrationForm.value.clubId = resetUnregisteredClubForGrade(
    studentRegistrationForm.value.clubId,
    studentRegistrationForm.value.grade,
    clubs.value,
    currentStudentRegistration.value
  )
}

// 获取社团列表
const loadClubs = async (): Promise<boolean> => {
  loading.value = true
  try {
    const response = await axios.get('/api/clubs')
    clubs.value = response.data
    return true
  } catch (error: any) {
    ElMessage.error('获取社团列表失败')
    console.error(error)
    return false
  } finally {
    loading.value = false
  }
}

// 获取报名记录
const loadRegistrations = async (): Promise<boolean> => {
  try {
    const response = await axios.get('/api/registrations')
    registrations.value = response.data
    return true
  } catch (error: any) {
    ElMessage.error('获取报名记录失败')
    console.error(error)
    return false
  }
}

// 获取学生列表
const loadStudents = async (): Promise<boolean> => {
  try {
    const response = await axios.get('/api/students')
    students.value = response.data
    return true
  } catch (error: any) {
    ElMessage.error('获取学生列表失败')
    console.error(error)
    return false
  }
}

const emptyStudentRegistrationForm = () => ({
  idCard: '',
  name: '',
  grade: '',
  className: '',
  clubId: null as number | null
})

const clearStudentRegistrationResult = () => {
  studentRegistrationLookupSequence += 1
  studentRegistrationLookupController?.abort()
  studentRegistrationLookupController = null
  studentRegistrationLoading.value = false
  studentRegistrationRecord.value = null
  studentRegistrationForm.value = emptyStudentRegistrationForm()
}

const clearStudentRegistration = () => {
  if (isStudentRegistrationFormDirty.value) {
    ElMessageBox.confirm('当前有未保存修改，确认清空吗？', '提示', {
      confirmButtonText: '清空',
      cancelButtonText: '取消',
      type: 'warning'
    }).then(() => {
      studentRegistrationSearchIdCard.value = ''
      clearStudentRegistrationResult()
    }).catch(() => {})
    return
  }

  studentRegistrationSearchIdCard.value = ''
  clearStudentRegistrationResult()
}

const handleStudentRegistrationSearchInput = () => {
  if (isStudentRegistrationFormDirty.value && studentRegistrationRecord.value) {
    studentRegistrationSearchIdCard.value = studentRegistrationRecord.value.student.idCard
    ElMessage.warning('当前信息有未保存修改，请先保存或清空后再查询')
    return
  }

  clearStudentRegistrationResult()
}

const lookupStudentRegistration = async (force = false): Promise<boolean> => {
  const idCard = studentRegistrationSearchIdCard.value.trim()
  if (!/^\d{17}[\dXx]$/.test(idCard)) {
    ElMessage.warning('请输入正确的18位身份证号')
    return false
  }
  if (
    !force &&
    studentRegistrationRecord.value &&
    isStudentRegistrationFormDirty.value
  ) {
    ElMessage.warning('当前信息有未保存修改，请先保存或清空后再查询')
    return false
  }

  studentRegistrationLookupController?.abort()
  const controller = new AbortController()
  studentRegistrationLookupController = controller
  const requestSequence = ++studentRegistrationLookupSequence
  studentRegistrationLoading.value = true
  try {
    const response = await axios.post(
      '/api/admin/student-registration/lookup',
      { idCard },
      { signal: controller.signal }
    )
    if (
      requestSequence !== studentRegistrationLookupSequence ||
      studentRegistrationSearchIdCard.value.trim() !== idCard
    ) {
      return false
    }
    if (!response.data.success) {
      ElMessage.error(response.data.message || '查询失败')
      return false
    }

    const data = response.data.data as StudentRegistrationRecord
    studentRegistrationRecord.value = data
    studentRegistrationSearchIdCard.value = data.student.idCard
    studentRegistrationForm.value = studentRegistrationFormFromRecord(data)
    return true
  } catch (error: any) {
    if (controller.signal.aborted || axios.isCancel(error)) return false
    if (requestSequence !== studentRegistrationLookupSequence) return false
    ElMessage.error(error.response?.data?.message || '查询失败')
    console.error(error)
    return false
  } finally {
    if (requestSequence === studentRegistrationLookupSequence) {
      studentRegistrationLoading.value = false
      if (studentRegistrationLookupController === controller) {
        studentRegistrationLookupController = null
      }
    }
  }
}

const saveStudentRegistration = async () => {
  const record = studentRegistrationRecord.value
  if (!record) return

  if (!studentRegistrationForm.value.name.trim() || !studentRegistrationForm.value.className.trim()) {
    ElMessage.warning('姓名和班级不能为空')
    return
  }

  if (!/^\d{17}[\dXx]$/.test(studentRegistrationForm.value.idCard.trim())) {
    ElMessage.warning('身份证号格式不正确')
    return
  }

  if (!GRADE_OPTIONS.includes(studentRegistrationForm.value.grade)) {
    ElMessage.warning('请选择年级')
    return
  }

  if (record.registration && studentRegistrationForm.value.clubId === null) {
    ElMessage.warning('已有报名记录不能清空社团')
    return
  }

  const studentId = record.student.id
  const payload = {
    ...studentRegistrationForm.value,
    idCard: studentRegistrationForm.value.idCard.trim().replace(/x$/i, 'X'),
    name: studentRegistrationForm.value.name.trim(),
    className: studentRegistrationForm.value.className.trim()
  }

  studentRegistrationSaving.value = true
  try {
    const response = await axios.put(
      `/api/admin/student-registration/${studentId}`,
      payload
    )

    if (!response.data.success) {
      ElMessage.error(response.data.message || '保存失败')
      return
    }

    const savedRecord = response.data.data as StudentRegistrationRecord
    studentRegistrationRecord.value = savedRecord
    studentRegistrationForm.value = studentRegistrationFormFromRecord(savedRecord)
    const refreshResults = await Promise.all([loadClubs(), loadRegistrations(), loadStudents()])
    studentRegistrationSearchIdCard.value = savedRecord.student.idCard
    const lookupSucceeded = await lookupStudentRegistration(true)
    if (studentRegistrationSaveWasRefreshedSuccessfully(refreshResults, lookupSucceeded)) {
      ElMessage.success('保存成功')
    } else {
      ElMessage.warning('保存成功，但页面刷新失败，请重新查询')
    }
  } catch (error: any) {
    ElMessage.error(error.response?.data?.message || '保存失败')
    console.error(error)
  } finally {
    studentRegistrationSaving.value = false
  }
}

// 编辑社团
const handleEdit = (club: any) => {
  editForm.value = {
    id: club.id,
    name: club.name,
    grades: parseClubGrades(club.grades, club.grade),
    total_quota: club.total_quota,
    manager: club.manager || '',
    manager_contact: club.manager_contact || ''
  }
  editDialogVisible.value = true
}

// 保存编辑
const handleSave = async () => {
  if (editForm.value.grades.length === 0) {
    ElMessage.warning('请至少选择一个可报名年级')
    return
  }

  try {
    const response = await axios.put(`/api/clubs/${editForm.value.id}`, editForm.value)
    if (response.data.success) {
      ElMessage.success('保存成功')
      editDialogVisible.value = false
      loadClubs()
    } else {
      ElMessage.error(response.data.message || '保存失败')
    }
  } catch (error: any) {
    ElMessage.error(error.response?.data?.message || '保存失败')
    console.error(error)
  }
}

// 新增社团
const handleAdd = () => {
  addForm.value = {
    name: '',
    description: '',
    grades: [],
    total_quota: 50,
    manager: '',
    manager_contact: ''
  }
  addDialogVisible.value = true
}

// 保存新增社团
const handleSaveAdd = async () => {
  if (!addForm.value.name.trim()) {
    ElMessage.warning('请输入社团名称')
    return
  }

  if (addForm.value.grades.length === 0) {
    ElMessage.warning('请至少选择一个可报名年级')
    return
  }

  try {
    const response = await axios.post('/api/clubs', addForm.value)
    if (response.data.success) {
      ElMessage.success('社团创建成功')
      addDialogVisible.value = false
      loadClubs()
    } else {
      ElMessage.error(response.data.message || '创建失败')
    }
  } catch (error: any) {
    ElMessage.error(error.response?.data?.message || '创建失败')
    console.error(error)
  }
}

// 删除社团
const handleDelete = (club: any) => {
  ElMessageBox.confirm(`确定要删除社团「${club.name}」吗？`, '提示', {
    confirmButtonText: '确定',
    cancelButtonText: '取消',
    type: 'warning'
  }).then(async () => {
    try {
      const response = await axios.delete(`/api/clubs/${club.id}`)
      if (response.data.success) {
        ElMessage.success(response.data.message)
        loadClubs()
      } else {
        ElMessage.error(response.data.message || '删除失败')
      }
    } catch (error: any) {
      ElMessage.error(error.response?.data?.message || '删除失败')
      console.error(error)
    }
  }).catch(() => {})
}

// 查看统计
const goToStats = () => {
  router.push('/admin/stats')
}

// 导出数据
const handleExport = async () => {
  try {
    const response = await axios.get('/api/export', {
      responseType: 'blob'
    })
    const url = window.URL.createObjectURL(new Blob([response.data]))
    const link = document.createElement('a')
    link.href = url
    link.setAttribute('download', `registrations_${Date.now()}.csv`)
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.URL.revokeObjectURL(url)
    ElMessage.success('导出成功')
  } catch (error: any) {
    ElMessage.error('导出失败')
    console.error(error)
  }
}

// 导出社团数据
const handleClubExport = async () => {
  try {
    const response = await axios.get('/api/clubs/export', { responseType: 'blob' })
    const url = window.URL.createObjectURL(new Blob([response.data]))
    const link = document.createElement('a')
    link.href = url
    link.download = `clubs_${Date.now()}.xlsx`
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.URL.revokeObjectURL(url)
    ElMessage.success('社团数据导出成功')
  } catch (error: any) {
    ElMessage.error('社团数据导出失败')
    console.error(error)
  }
}

// 退出登录
const handleLogout = () => {
  ElMessageBox.confirm('确定要退出登录吗？', '提示', {
    confirmButtonText: '确定',
    cancelButtonText: '取消',
    type: 'warning'
  }).then(() => {
    sessionStorage.removeItem('isLoggedIn')
    ElMessage.success('已退出登录')
    router.push('/')
  }).catch(() => {})
}

// 返回首页
const goHome = () => {
  router.push('/')
}

// 处理文件选择
const handleFileChange = (file: unknown) => {
  selectedFile.value = getRawFile(file)
  return false // 阻止自动上传
}

// 处理社团文件选择
const handleClubFileChange = (file: unknown) => {
  selectedClubFile.value = getRawFile(file)
  return false
}

// 导入社团数据
const handleClubImport = async () => {
  if (!selectedClubFile.value) {
    ElMessage.warning('请选择社团文件')
    return
  }

  clubImportLoading.value = true
  const formData = new FormData()
  formData.append('file', selectedClubFile.value)

  try {
    const response = await axios.post('/api/clubs/import', formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    })
    if (response.data.success) {
      clubImportResult.value = response.data.data
      ElMessage.success(response.data.message || '社团导入成功')
      await loadClubs()
    } else {
      ElMessage.error(response.data.message || '社团导入失败')
    }
  } catch (error: any) {
    ElMessage.error(error.response?.data?.message || '社团导入失败')
    console.error(error)
  } finally {
    clubImportLoading.value = false
  }
}

const closeClubImportDialog = () => {
  clubImportDialogVisible.value = false
  selectedClubFile.value = null
  clubImportResult.value = null
}

// 导入学生信息
const handleImport = async () => {
  if (!selectedFile.value) {
    ElMessage.warning('请选择文件')
    return
  }

  importLoading.value = true
  const formData = new FormData()
  formData.append('file', selectedFile.value)

  try {
    const response = await axios.post('/api/students/import', formData, {
      headers: {
        'Content-Type': 'multipart/form-data'
      }
    })

    if (response.data.success) {
      importResult.value = response.data.data
      ElMessage.success(response.data.message)
      loadStudents()
    } else {
      ElMessage.error(response.data.message || '导入失败')
    }
  } catch (error: any) {
    ElMessage.error(error.response?.data?.message || '导入失败')
    console.error(error)
  } finally {
    importLoading.value = false
  }
}

// 清空学生信息
const handleClearStudents = () => {
  ElMessageBox.confirm('确定要清空所有学生信息吗？此操作不可恢复！', '警告', {
    confirmButtonText: '确定',
    cancelButtonText: '取消',
    type: 'warning'
  }).then(async () => {
    try {
      const response = await axios.delete('/api/students')
      if (response.data.success) {
        ElMessage.success('清空成功')
        students.value = []
      } else {
        ElMessage.error(response.data.message || '清空失败')
      }
    } catch (error: any) {
      ElMessage.error('清空失败')
      console.error(error)
    }
  }).catch(() => {})
}

// 清空报名数据
const handleClearRegistrations = () => {
  ElMessageBox.confirm('确定要清空所有报名数据吗？此操作将同时重置所有社团名额，且不可恢复！', '警告', {
    confirmButtonText: '确定',
    cancelButtonText: '取消',
    type: 'warning'
  }).then(async () => {
    try {
      const response = await axios.delete('/api/registrations')
      if (response.data.success) {
        ElMessage.success(response.data.message)
        registrations.value = []
        loadClubs() // 重新加载社团信息以显示更新后的名额
      } else {
        ElMessage.error(response.data.message || '清空失败')
      }
    } catch (error: any) {
      ElMessage.error(error.response?.data?.message || '清空失败')
      console.error(error)
    }
  }).catch(() => {})
}

// 下载模板
const downloadTemplate = () => {
  const template = '姓名\t身份证号\t年级\t班级\n张三\t123456789012345678\t初一\t初一(1)班\n李四\t987654321098765432\t初二\t初二(2)班'
  const blob = new Blob([template], { type: 'text/plain;charset=utf-8' })
  const url = window.URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.setAttribute('download', '学生信息导入模板.txt')
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.URL.revokeObjectURL(url)
}

// 关闭导入对话框
const closeImportDialog = () => {
  importDialogVisible.value = false
  selectedFile.value = null
  importResult.value = null
}

// 报名开放时间设置
const openTimeDialogVisible = ref(false)
const openAt = ref<string | null>(null)
const newOpenAt = ref<Date | null>(null)
const savingOpenTime = ref(false)
const registrationTitleDraft = ref(DEFAULT_REGISTRATION_TITLE)
const savingRegistrationTitle = ref(false)

// 获取报名入口标题
const loadRegistrationTitle = async () => {
  try {
    const response = await axios.get('/api/settings/registration-title')
    const title = response.data.data?.title
    registrationTitleDraft.value = typeof title === 'string' && title.trim()
      ? title.trim()
      : DEFAULT_REGISTRATION_TITLE
  } catch (error: any) {
    registrationTitleDraft.value = DEFAULT_REGISTRATION_TITLE
    console.error(error)
  }
}

// 保存报名入口标题
const handleSaveRegistrationTitle = async () => {
  savingRegistrationTitle.value = true
  try {
    const response = await axios.put('/api/settings/registration-title', {
      title: registrationTitleDraft.value,
    })
    if (response.data.success) {
      registrationTitleDraft.value = response.data.data?.title || DEFAULT_REGISTRATION_TITLE
      ElMessage.success(response.data.message)
    } else {
      ElMessage.error(response.data.message || '标题保存失败')
    }
  } catch (error: any) {
    ElMessage.error(error.response?.data?.message || '标题保存失败')
    console.error(error)
  } finally {
    savingRegistrationTitle.value = false
  }
}

// 获取当前设置
const loadOpenTime = async () => {
  try {
    const response = await axios.get('/api/settings/registration-open-time')
    openAt.value = response.data.data?.openAt ?? null
  } catch (error: any) {
    console.error(error)
  }
}

// Date -> +08:00 ISO 字符串（与后端约定一致）
const toUtc8Iso = (d: Date) => {
  const pad = (n: number) => String(n).padStart(2, '0')
  const utc8 = new Date(d.getTime() + 8 * 60 * 60 * 1000)
  return `${utc8.getUTCFullYear()}-${pad(utc8.getUTCMonth() + 1)}-${pad(utc8.getUTCDate())}T${pad(utc8.getUTCHours())}:${pad(utc8.getUTCMinutes())}:${pad(utc8.getUTCSeconds())}+08:00`
}

// 展示格式化（浏览器本地时区即 +08:00）
const formatOpenAt = (iso: string) => new Date(iso).toLocaleString('zh-CN')

// 保存设置
const handleSaveOpenTime = async () => {
  if (!newOpenAt.value) {
    ElMessage.warning('请选择开放时间')
    return
  }
  savingOpenTime.value = true
  try {
    const response = await axios.put('/api/settings/registration-open-time', {
      openAt: toUtc8Iso(newOpenAt.value)
    })
    if (response.data.success) {
      ElMessage.success(response.data.message)
      openAt.value = toUtc8Iso(newOpenAt.value)
      openTimeDialogVisible.value = false
    } else {
      ElMessage.error(response.data.message)
    }
  } catch (error: any) {
    ElMessage.error(error.response?.data?.message || '设置失败')
    console.error(error)
  } finally {
    savingOpenTime.value = false
  }
}

// 清除设置
const handleClearOpenTime = () => {
  ElMessageBox.confirm('确定要清除报名开放时间设置吗？清除后学生可随时报名。', '提示', {
    confirmButtonText: '确定',
    cancelButtonText: '取消',
    type: 'warning'
  }).then(async () => {
    try {
      const response = await axios.put('/api/settings/registration-open-time', { openAt: null })
      if (response.data.success) {
        ElMessage.success(response.data.message)
        openAt.value = null
      }
    } catch (error: any) {
      ElMessage.error(error.response?.data?.message || '清除失败')
      console.error(error)
    }
  }).catch(() => {})
}

// 初始化
onMounted(() => {
  loadClubs()
  loadRegistrations()
  loadStudents()
  loadOpenTime()
  loadRegistrationTitle()
})

onUnmounted(() => {
  studentRegistrationLookupController?.abort()
})
</script>

<template>
  <div class="admin-container">
    <div class="header">
      <div class="header-left">
        <el-button @click="goHome" :icon="'ArrowLeft'">返回首页</el-button>
        <h1>行知中学</h1>
        <span class="subtitle">社团管理后台</span>
      </div>
      <div class="header-right">
        <el-button type="info" @click="goToStats" :icon="'DataLine'">
          统计
        </el-button>
        <el-button type="success" @click="handleExport" :icon="'Download'">
          导出数据
        </el-button>
        <el-button type="danger" @click="handleLogout" :icon="'SwitchButton'">
          退出登录
        </el-button>
      </div>
    </div>

    <el-tabs v-model="activeTab" class="admin-tabs">
      <!-- 社团管理 -->
      <el-tab-pane label="社团管理" name="clubs">
        <el-card>
          <template #header>
            <div class="card-header">
              <span>社团列表 (共 {{ clubs.length }} 个)</span>
              <div class="header-buttons">
                <el-button type="primary" @click="clubImportDialogVisible = true" :icon="'Upload'">
                  导入社团
                </el-button>
                <el-button type="info" @click="handleClubExport" :icon="'Download'">
                  导出 Excel
                </el-button>
                <el-button type="primary" @click="handleAdd" :icon="'Plus'">
                  新增社团
                </el-button>
              </div>
            </div>
          </template>
          <el-table :data="clubs" v-loading="loading" stripe>
            <el-table-column prop="id" label="ID" width="80" />
            <el-table-column prop="name" label="社团名称" width="150" />
            <el-table-column prop="grade" label="可报名年级" width="120">
              <template #default="{ row }">
                {{ parseClubGrades(row.grades, row.grade).join('、') || '未设置' }}
              </template>
            </el-table-column>
            <el-table-column prop="description" label="描述" min-width="180">
              <template #default="{ row }">
                {{ row.description || '-' }}
              </template>
            </el-table-column>
            <el-table-column prop="total_quota" label="最大报名人数" width="120" />
            <el-table-column prop="remaining_quota" label="剩余名额" width="100" />
            <el-table-column prop="manager" label="社团负责人" width="120">
              <template #default="{ row }">
                {{ row.manager || '-' }}
              </template>
            </el-table-column>
            <el-table-column prop="manager_contact" label="负责人联系方式" width="150">
              <template #default="{ row }">
                {{ row.manager_contact || '-' }}
              </template>
            </el-table-column>
            <el-table-column prop="created_at" label="创建时间" width="180">
              <template #default="{ row }">
                {{ new Date(row.created_at).toLocaleString('zh-CN') }}
              </template>
            </el-table-column>
            <el-table-column label="操作" width="150" fixed="right">
              <template #default="{ row }">
                <el-button type="primary" size="small" @click="handleEdit(row)">
                  编辑
                </el-button>
                <el-button type="danger" size="small" @click="handleDelete(row)">
                  删除
                </el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-tab-pane>

      <!-- 报名记录 -->
      <el-tab-pane label="报名记录" name="registrations">
        <el-card>
          <template #header>
            <div class="card-header">
              <span>报名记录列表 (共 {{ registrations.length }} 条)</span>
              <div class="header-buttons">
                <el-button type="danger" @click="handleClearRegistrations" :icon="'Delete'">
                  清空报名数据
                </el-button>
              </div>
            </div>
          </template>
          <el-table :data="registrations" stripe max-height="500">
            <el-table-column prop="id" label="ID" width="80" />
            <el-table-column prop="name" label="姓名" width="100" />
            <el-table-column prop="className" label="班级" width="180" />
            <el-table-column prop="clubName" label="社团" width="120" />
            <el-table-column prop="time" label="报名时间" width="180">
              <template #default="{ row }">
                {{ new Date(row.time).toLocaleString('zh-CN') }}
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-tab-pane>

      <!-- 学生信息管理 -->
      <el-tab-pane label="学生信息管理" name="students">
        <el-card>
          <template #header>
            <div class="card-header">
              <span>学生信息列表 (共 {{ students.length }} 人)</span>
              <div class="header-buttons">
                <el-button type="primary" @click="importDialogVisible = true" :icon="'Upload'">
                  导入学生信息
                </el-button>
                <el-button type="info" @click="downloadTemplate" :icon="'Download'">
                  下载模板
                </el-button>
                <el-button type="danger" @click="handleClearStudents" :icon="'Delete'">
                  清空数据
                </el-button>
              </div>
            </div>
          </template>
          <el-table :data="students" stripe max-height="500">
            <el-table-column prop="id" label="ID" width="80" />
            <el-table-column prop="name" label="姓名" width="120" />
            <el-table-column prop="id_card" label="身份证号" width="200">
              <template #default="{ row }">
                {{ row.id_card.replace(/(\d{4})\d{10}(\d{4})/, '$1****$2') }}
              </template>
            </el-table-column>
            <el-table-column prop="grade" label="年级" width="100">
              <template #default="{ row }">
                {{ row.grade || '未设置' }}
              </template>
            </el-table-column>
            <el-table-column prop="class_name" label="班级" width="150" />
            <el-table-column prop="created_at" label="导入时间" width="180">
              <template #default="{ row }">
                {{ new Date(row.created_at).toLocaleString('zh-CN') }}
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-tab-pane>

      <!-- 修改学生信息和报名 -->
      <el-tab-pane label="修改信息" name="student-registration">
        <div class="student-registration-search">
          <el-input
            v-model="studentRegistrationSearchIdCard"
            maxlength="18"
            clearable
            placeholder="请输入学生身份证号"
            :disabled="studentRegistrationSaving"
            @input="handleStudentRegistrationSearchInput"
            @keyup.enter="lookupStudentRegistration()"
          />
          <el-button
            type="primary"
            :loading="studentRegistrationLoading"
            :disabled="studentRegistrationSaving || studentRegistrationLoading"
            @click="lookupStudentRegistration()"
          >
            查询
          </el-button>
          <el-button :icon="'Refresh'" :disabled="studentRegistrationSaving" @click="clearStudentRegistration">
            清空
          </el-button>
        </div>

        <el-alert
          v-if="!studentRegistrationRecord"
          title="请输入身份证号查询学生信息"
          type="info"
          :closable="false"
          class="student-registration-empty"
        />

        <div v-else class="student-registration-layout">
          <el-card class="student-registration-panel" shadow="never">
            <template #header>
              <div class="student-registration-panel-title">学生信息</div>
            </template>
            <el-form
              :model="studentRegistrationForm"
              label-width="90px"
              :disabled="studentRegistrationSaving || studentRegistrationLoading"
            >
              <el-form-item label="姓名" required>
                <el-input v-model="studentRegistrationForm.name" />
              </el-form-item>
              <el-form-item label="身份证号" required>
                <el-input v-model="studentRegistrationForm.idCard" maxlength="18" />
              </el-form-item>
              <el-form-item label="年级" required>
                <el-select
                  v-model="studentRegistrationForm.grade"
                  style="width: 100%"
                  @change="handleStudentRegistrationGradeChange"
                >
                  <el-option
                    v-for="grade in GRADE_OPTIONS"
                    :key="grade"
                    :label="grade"
                    :value="grade"
                  />
                </el-select>
              </el-form-item>
              <el-form-item label="班级" required>
                <el-input v-model="studentRegistrationForm.className" />
              </el-form-item>
            </el-form>
          </el-card>

          <el-card class="student-registration-panel" shadow="never">
            <template #header>
              <div class="student-registration-panel-title">报名信息</div>
            </template>
            <el-descriptions :column="1" border>
              <el-descriptions-item label="当前社团">
                {{ currentStudentRegistration?.clubName || '暂无报名' }}
              </el-descriptions-item>
              <el-descriptions-item v-if="currentStudentRegistration" label="报名时间">
                {{ new Date(currentStudentRegistration.time).toLocaleString('zh-CN') }}
              </el-descriptions-item>
            </el-descriptions>

            <el-form
              :model="studentRegistrationForm"
              label-width="90px"
              :disabled="studentRegistrationSaving || studentRegistrationLoading"
              class="student-registration-club-form"
            >
              <el-form-item label="报名社团">
                <el-select
                  v-model="studentRegistrationForm.clubId"
                  placeholder="可不选择社团"
                  :clearable="!currentStudentRegistration"
                  style="width: 100%"
                >
                  <el-option
                    v-for="club in studentRegistrationClubs"
                    :key="club.id"
                    :label="`${club.name}（${parseClubGrades(club.grades, club.grade).join('、') || '未设置'}，剩余 ${club.remaining_quota}）`"
                    :value="club.id"
                    :disabled="isStudentRegistrationClubDisabled(club)"
                  />
                </el-select>
              </el-form-item>
            </el-form>

            <el-alert
              v-if="currentStudentRegistration"
              title="已有报名记录不能清空，只能保留或更换社团"
              type="warning"
              :closable="false"
            />
          </el-card>
        </div>

        <div v-if="studentRegistrationRecord" class="student-registration-actions">
          <el-button
            type="primary"
            :loading="studentRegistrationSaving"
            :disabled="studentRegistrationSaving || studentRegistrationLoading"
            @click="saveStudentRegistration"
          >
            保存全部修改
          </el-button>
        </div>
      </el-tab-pane>

      <!-- 报名设置 -->
      <el-tab-pane label="系统设置" name="settings">
        <el-card>
          <template #header>
            <div class="card-header">
              <span>报名入口标题栏</span>
            </div>
          </template>
          <el-form label-width="120px" @submit.prevent>
            <el-form-item label="标题">
              <el-input
                v-model="registrationTitleDraft"
                maxlength="30"
                show-word-limit
                clearable
                placeholder="默认：社团报名系统"
              />
            </el-form-item>
            <el-button
              type="primary"
              :loading="savingRegistrationTitle"
              @click="handleSaveRegistrationTitle"
            >
              保存标题
            </el-button>
          </el-form>
        </el-card>
        <el-card>
          <template #header>
            <div class="card-header">
              <span>报名开放时间设置</span>
              <div class="header-buttons">
                <el-button type="primary" @click="openTimeDialogVisible = true" :icon="'Clock'">
                  设置开放时间
                </el-button>
              </div>
            </div>
          </template>
          <el-alert
            v-if="openAt === null"
            title="当前未设置报名开放时间，学生可随时报名"
            type="info"
            :closable="false"
          />
          <el-alert
            v-else
            type="success"
            :closable="false"
          >
            <template #default>
              <div>报名将于 {{ formatOpenAt(openAt) }} 开放，到达开放时间后学生可自动报名。</div>
              <el-button type="danger" size="small" @click="handleClearOpenTime" style="margin-top: 8px">
                清除设置
              </el-button>
            </template>
          </el-alert>
          <p class="settings-tip">设置后，学生在开放时间之前无法提交报名；未设置时学生可随时报名。</p>
        </el-card>
      </el-tab-pane>
    </el-tabs>

    <!-- 编辑对话框 -->
    <el-dialog v-model="editDialogVisible" title="编辑社团信息" width="500px">
      <el-form :model="editForm" label-width="120px">
        <el-form-item label="社团名称">
          <el-input v-model="editForm.name" disabled />
        </el-form-item>
        <el-form-item label="可报名年级" required>
          <el-select
            v-model="editForm.grades"
            multiple
            collapse-tags
            collapse-tags-tooltip
            clearable
            placeholder="请选择可报名年级"
            style="width: 100%"
          >
            <el-option v-for="grade in GRADE_OPTIONS" :key="grade" :label="grade" :value="grade" />
          </el-select>
        </el-form-item>
        <el-form-item label="最大报名人数">
          <el-input-number v-model="editForm.total_quota" :min="1" :max="1000" />
        </el-form-item>
        <el-form-item label="社团负责人">
          <el-input v-model="editForm.manager" placeholder="选填" />
        </el-form-item>
        <el-form-item label="负责人联系方式">
          <el-input v-model="editForm.manager_contact" placeholder="选填" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="handleSave">保存</el-button>
      </template>
    </el-dialog>

    <!-- 新增社团对话框 -->
    <el-dialog v-model="addDialogVisible" title="新增社团" width="500px">
      <el-form :model="addForm" label-width="120px">
        <el-form-item label="社团名称" required>
          <el-input v-model="addForm.name" placeholder="请输入社团名称" />
        </el-form-item>
        <el-form-item label="社团描述">
          <el-input v-model="addForm.description" type="textarea" :rows="2" placeholder="请输入社团描述（选填）" />
        </el-form-item>
        <el-form-item label="可报名年级" required>
          <el-select
            v-model="addForm.grades"
            multiple
            collapse-tags
            collapse-tags-tooltip
            clearable
            placeholder="请选择可报名年级"
            style="width: 100%"
          >
            <el-option v-for="grade in GRADE_OPTIONS" :key="grade" :label="grade" :value="grade" />
          </el-select>
        </el-form-item>
        <el-form-item label="最大报名人数" required>
          <el-input-number v-model="addForm.total_quota" :min="1" :max="1000" />
        </el-form-item>
        <el-form-item label="社团负责人">
          <el-input v-model="addForm.manager" placeholder="选填" />
        </el-form-item>
        <el-form-item label="负责人联系方式">
          <el-input v-model="addForm.manager_contact" placeholder="选填" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="addDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="handleSaveAdd">创建</el-button>
      </template>
    </el-dialog>

    <!-- 导入社团对话框 -->
    <el-dialog v-model="clubImportDialogVisible" title="导入社团数据" width="520px" @close="closeClubImportDialog">
      <div class="import-content">
        <el-alert title="导入说明" type="info" :closable="false" style="margin-bottom: 20px">
          <template #default>
            <p>1. 支持 Excel 文件（.xlsx、.xls）或 CSV 文件（.csv）</p>
            <p>2. 必填列：社团名称、可报名年级、最大报名人数（年级可填写多个）</p>
            <p>3. 同名社团会更新，不同名社团会新增</p>
            <p>4. 新最大报名人数不能小于已有报名人数</p>
          </template>
        </el-alert>

        <el-upload
          :auto-upload="false"
          :limit="1"
          :on-change="handleClubFileChange"
          accept=".xlsx,.xls,.csv"
          drag
        >
          <el-icon class="el-icon--upload"><upload-filled /></el-icon>
          <div class="el-upload__text">
            将文件拖到此处，或<em>点击上传</em>
          </div>
          <template #tip>
            <div class="el-upload__tip">
              只能上传 xlsx/xls/csv 文件，且不超过 5MB
            </div>
          </template>
        </el-upload>

        <div v-if="clubImportResult" class="import-result">
          <el-divider />
          <h4>导入结果</h4>
          <p>新增: {{ clubImportResult.createdCount }} 条</p>
          <p>更新: {{ clubImportResult.updatedCount }} 条</p>
          <p>跳过: {{ clubImportResult.skipCount }} 条</p>
          <div v-if="clubImportResult.errors.length > 0">
            <p>错误信息:</p>
            <ul>
              <li v-for="(error, index) in clubImportResult.errors" :key="index">{{ error }}</li>
            </ul>
          </div>
        </div>
      </div>
      <template #footer>
        <el-button @click="closeClubImportDialog">取消</el-button>
        <el-button type="primary" @click="handleClubImport" :loading="clubImportLoading">
          开始导入
        </el-button>
      </template>
    </el-dialog>

    <!-- 导入学生对话框 -->
    <el-dialog v-model="importDialogVisible" title="导入学生信息" width="500px" @close="closeImportDialog">
      <div class="import-content">
        <el-alert
          title="导入说明"
          type="info"
          :closable="false"
          style="margin-bottom: 20px"
        >
          <template #default>
            <p>1. 支持 Excel 文件（.xlsx, .xls）或文本文件（.txt, .csv）</p>
            <p>2. 文件需包含：姓名、身份证号、年级、班级 四列</p>
            <p>3. Excel 表头列名：姓名/身份证号/年级/班级 或 name/idCard/grade/className</p>
            <p>4. 文本文件以 Tab 分隔，第一行为表头</p>
          </template>
        </el-alert>

        <el-upload
          :auto-upload="false"
          :limit="1"
          :on-change="handleFileChange"
          accept=".xlsx,.xls,.txt,.csv"
          drag
        >
          <el-icon class="el-icon--upload"><upload-filled /></el-icon>
          <div class="el-upload__text">
            将文件拖到此处，或<em>点击上传</em>
          </div>
          <template #tip>
            <div class="el-upload__tip">
              只能上传 xlsx/xls/txt/csv 文件，且不超过 5MB
            </div>
          </template>
        </el-upload>

        <!-- 导入结果 -->
        <div v-if="importResult" class="import-result">
          <el-divider />
          <h4>导入结果</h4>
          <p>成功导入: {{ importResult.successCount }} 条</p>
          <p>跳过: {{ importResult.skipCount }} 条</p>
          <div v-if="importResult.errors.length > 0">
            <p>错误信息:</p>
            <ul>
              <li v-for="(error, index) in importResult.errors" :key="index">{{ error }}</li>
            </ul>
          </div>
        </div>
      </div>
      <template #footer>
        <el-button @click="closeImportDialog">取消</el-button>
        <el-button type="primary" @click="handleImport" :loading="importLoading">
          开始导入
        </el-button>
      </template>
    </el-dialog>

    <!-- 设置开放时间对话框 -->
    <el-dialog v-model="openTimeDialogVisible" title="设置报名开放时间" width="420px">
      <el-form label-width="100px">
        <el-form-item label="开放时间" required>
          <el-date-picker
            v-model="newOpenAt"
            type="datetime"
            placeholder="选择报名开放时间"
            style="width: 100%"
            :disabled-date="(d: Date) => d.getTime() <= Date.now()"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="openTimeDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="handleSaveOpenTime" :loading="savingOpenTime">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script lang="ts">
import { UploadFilled } from '@element-plus/icons-vue'

export default {
  components: { UploadFilled },
  data() {
    return {
      activeTab: 'clubs'
    }
  }
}
</script>

<style scoped>
.admin-container {
  width: 100%;
  max-width: 1400px;
  min-width: 0;
  margin: 0 auto;
  padding: 20px;
  min-height: 100vh;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
  padding-bottom: 20px;
  border-bottom: 1px solid #ebeef5;
}

.header-left {
  display: flex;
  align-items: baseline;
  gap: 12px;
}

.header-left h1 {
  margin: 0;
  color: #303133;
  font-size: 24px;
  font-weight: 700;
}

.header-left .subtitle {
  color: #909399;
  font-size: 16px;
}

.header-right {
  display: flex;
  gap: 10px;
}

.admin-tabs {
  margin-top: 20px;
}

.el-card {
  margin-bottom: 20px;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.header-buttons {
  display: flex;
  gap: 10px;
}

/* The app shell centers inline scrollbar views, so keep table bodies flush with their headers. */
.admin-container :deep(.el-table__body-wrapper .el-scrollbar__wrap) {
  text-align: left;
}

.student-registration-search {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 20px;
}

.student-registration-search .el-input {
  width: min(420px, 100%);
}

.student-registration-empty {
  margin-bottom: 20px;
}

.student-registration-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 24px;
}

.student-registration-panel {
  min-width: 0;
}

.student-registration-panel-title {
  font-weight: 600;
}

.student-registration-club-form {
  margin-top: 20px;
}

.student-registration-actions {
  display: flex;
  justify-content: center;
  margin-top: 24px;
}

.import-content {
  padding: 10px 0;
}

.import-result {
  margin-top: 20px;
}

.import-result h4 {
  margin: 0 0 10px 0;
}

.import-result p {
  margin: 5px 0;
}

.import-result ul {
  margin: 10px 0;
  padding-left: 20px;
  color: #f56c6c;
}

.import-result li {
  margin: 5px 0;
}

.settings-tip {
  margin: 16px 0 0 0;
  color: #909399;
  font-size: 13px;
}

@media (max-width: 768px) {
  .card-header {
    align-items: flex-start;
    flex-direction: column;
    gap: 12px;
  }

  .header-buttons {
    flex-wrap: wrap;
    width: 100%;
  }

  .header-buttons :deep(.el-button) {
    margin-left: 0;
  }

  .header {
    flex-wrap: wrap;
  }

  .header-left,
  .header-right {
    min-width: 0;
    flex-wrap: wrap;
  }

  .header-left {
    align-items: center;
  }

  .header-right {
    width: 100%;
  }

  .admin-tabs {
    overflow-x: auto;
  }

  .admin-tabs :deep(.el-tabs__nav) {
    min-width: max-content;
  }

  .student-registration-search {
    align-items: stretch;
    flex-wrap: wrap;
  }

  .student-registration-search .el-input {
    width: 100%;
  }

  .student-registration-layout {
    grid-template-columns: 1fr;
  }
}
</style>
