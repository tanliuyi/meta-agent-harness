<script setup lang="ts">
import ProviderCredentialsPanel from './ProviderCredentialsPanel.vue'
</script>

<template>
  <div class="models-page">
    <header class="models-page__header">
      <div>
        <p class="models-page__eyebrow">Auth</p>
        <h1 class="models-page__title">API Key</h1>
        <p class="models-page__subtitle">只保存 provider 凭据到 Pi-compatible auth.json。</p>
      </div>
    </header>

    <ProviderCredentialsPanel />
  </div>
</template>
