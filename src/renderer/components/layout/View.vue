<template>
  <div :class="$style.view">
    <router-view v-slot="{ Component, route }">
      <transition name="smooth-page">
        <component :is="Component" :key="route.name" class="view-container" />
      </transition>
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
  // background: #fff;
  // overflow: hidden;
}

</style>
