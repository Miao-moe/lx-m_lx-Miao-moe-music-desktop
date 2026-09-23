import { onBeforeUnmount, ref, type Ref, useCssModule } from '@common/utils/vueTools'
import { updateUserListPosition } from '@renderer/store/list/action'
import { userLists } from '@renderer/store/list/state'
import useDrag from '@renderer/utils/compositions/useDrag'

const LONG_PRESS_DELAY = 450

export default ({ dom_lists_list, handleSaveListName, handleMenuClick }: {
  dom_lists_list: Ref<HTMLElement | null>
  handleSaveListName: () => Promise<void> | void
  handleMenuClick: () => void
}) => {
  const isModDown = ref(false)
  const isDragging = ref(false)
  const styles = useCssModule()

  const drag = useDrag({
    dom_list: dom_lists_list,
    dragingItemClassName: styles.dragingItem,
    options: {
      delay: LONG_PRESS_DELAY,
      delayOnTouchOnly: false,
      touchStartThreshold: 5,
      forceFallback: true,
      fallbackTolerance: 3,
      direction: 'vertical',
      draggable: '.user-list',
      filter: `.${styles.editing}, input, textarea, select`,
      preventOnFilter: false,
      chosenClass: styles.chosenItem,
      onMove(event: { dragged: HTMLElement, related: HTMLElement }) {
        return event.dragged.dataset.group === event.related.dataset.group
      },
    },
    onStart() {
      isDragging.value = true
      handleMenuClick()
      void handleSaveListName()
    },
    onEnd() {
      isDragging.value = false
    },
    onUpdate(newIndex: number, oldIndex: number, item: HTMLElement) {
      const id = item.dataset.id
      const target = dom_lists_list.value?.querySelectorAll<HTMLElement>('.user-list')[newIndex]
      if (!id || newIndex == oldIndex || !target || target.dataset.group !== item.dataset.group) return
      const position = userLists.findIndex(list => list.id === target.dataset.id)
      if (position < 0 || !userLists.some(list => list.id === id)) return
      void updateUserListPosition({ ids: [id], position })
    },
  })

  const handle_key_mod_down = ({ event }: LX.KeyDownEevent) => {
    if (!isModDown.value) {
      const target = event?.target
      if (!(target instanceof HTMLElement)) return
      switch (target.tagName) {
        case 'INPUT':
        case 'SELECT':
        case 'TEXTAREA':
          return
        default: if (target.isContentEditable) return
      }

      isModDown.value = true
      drag.setDelay(0)
      void handleSaveListName()
    }
    handleMenuClick()
  }
  const handle_key_mod_up = () => {
    if (isModDown.value) {
      isModDown.value = false
      drag.setDelay(LONG_PRESS_DELAY)
    }
  }

  window.key_event.on('key_mod_down', handle_key_mod_down)
  window.key_event.on('key_mod_up', handle_key_mod_up)

  onBeforeUnmount(() => {
    window.key_event.off('key_mod_down', handle_key_mod_down)
    window.key_event.off('key_mod_up', handle_key_mod_up)
  })

  return {
    isModDown,
    isDragging,
  }
}
