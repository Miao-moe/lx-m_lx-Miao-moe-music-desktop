<template>
  <div :class="$style.view">
    <router-view v-slot="{ Component, route }">
      <!-- Vue 3.3.13 的 transition 包裹动态路由组件会反复触发渲染器崩溃
           （insertBefore / parentNode null / 导航卡死），保持禁用，勿重新启用 -->
      <component :is="Component" :key="route.name" class="view-container" />
    </router-view>
  </div>
</template>

<style lang="less" module>
@import '@renderer/assets/styles/layout.less';

.view {
  position: relative;
  z-index: 1;
  > :global(.view-container) {
    position: absolute !important;
    left: 0;
    top: 0;
    height: 100%;
    width: 100%;
  }
}

</style>
