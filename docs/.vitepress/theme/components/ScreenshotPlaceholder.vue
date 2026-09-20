<script setup lang="ts">
defineProps<{
  title: string;
  description: string;
  filename: string;
  src?: string;
  alt?: string;
  caption?: string;
}>();
</script>

<template>
  <figure class="screenshot-slot">
    <img v-if="src" :src="src" :alt="alt || title" loading="lazy" />
    <div v-else class="screenshot-slot__empty">
      <span class="screenshot-slot__mark" aria-hidden="true">⌗</span>
      <div>
        <strong>{{ title }}</strong>
        <p>{{ description }}</p>
      </div>
    </div>
    <figcaption v-if="src">
      {{ caption || '界面参考' }}
    </figcaption>
    <figcaption v-else>
      待补截图：<code>docs/public/screenshots/{{ filename }}</code>
    </figcaption>
  </figure>
</template>
