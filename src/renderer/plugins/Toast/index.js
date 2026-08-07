import Toast from './Toast.vue'
import { createApp } from 'vue'

let currentToast = null

/**
 * 在屏幕中间显示一个短暂的提示（Toast）
 * @param message 提示内容
 * @param autoCloseTime 自动关闭时间（毫秒）
 */
export default (message, { autoCloseTime = 1500 } = {}) => {
  if (currentToast) currentToast.cancel()

  let app = createApp(Toast, {
    afterLeave() {
      app.unmount()
      app = null
    },
  })
  const instance = app.mount(document.createElement('div'))

  instance.visible = true
  instance.message = message

  document.body.appendChild(instance.$el)

  let timer = null
  const toast = {
    cancel() {
      if (currentToast !== toast) return
      clearTimeout(timer)
      currentToast = null
      instance.visible = false
    },
  }
  currentToast = toast
  timer = setTimeout(() => {
    toast.cancel()
  }, autoCloseTime)

  return toast
}
