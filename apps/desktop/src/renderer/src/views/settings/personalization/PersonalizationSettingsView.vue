<script setup lang="ts">
import ScrollArea from '@/components/ui/scroll-area/ScrollArea.vue'
import { Slider } from '@/components/ui/slider'
import { BaseButton, BasePanel, BaseSegmentedControl } from '@renderer/components/base'
import { useAppearanceSettings } from '@renderer/composables/useAppearanceSettings'
import { useTheme } from '@renderer/composables/useTheme'
import SettingsSwitchField from '../components/form/SettingsSwitchField.vue'
import SettingsTextField from '../components/form/SettingsTextField.vue'
import type {
  ActivityDisplayMode,
  ActivityIndicatorStyle,
  AvatarStyle,
  ChatContentWidth,
  MarkdownFontStyle,
  MessageTimeDisplay,
  MotionPreference,
  SidebarDisplayMode,
  ToolExpansionMode,
  UiDensity,
  UserMessageAlignment
} from '@shared/coding-agent/types'
import { RotateCcw } from 'lucide-vue-next'
import { computed } from 'vue'

const appearanceSettings = useAppearanceSettings()
const { setThemeMode, themeMode, themeOptions } = useTheme()

const densityOptions: Array<{ label: string; value: UiDensity }> = [
  { label: '紧凑', value: 'compact' },
  { label: '标准', value: 'standard' },
  { label: '宽松', value: 'comfortable' }
]
const contentWidthOptions: Array<{ label: string; value: ChatContentWidth }> = [
  { label: '窄', value: 'narrow' },
  { label: '标准', value: 'standard' },
  { label: '宽', value: 'wide' }
]
const messageTimeOptions: Array<{ label: string; value: MessageTimeDisplay }> = [
  { label: '始终', value: 'always' },
  { label: '悬停', value: 'hover' },
  { label: '隐藏', value: 'hidden' }
]
const activityDisplayOptions: Array<{ label: string; value: ActivityDisplayMode }> = [
  { label: '完整', value: 'full' },
  { label: '精简', value: 'compact' },
  { label: '隐藏', value: 'hidden' }
]
const activityIndicatorOptions: Array<{ label: string; value: ActivityIndicatorStyle }> = [
  { label: '像素', value: 'pixels' },
  { label: '脉冲', value: 'pulse' },
  { label: '隐藏', value: 'hidden' }
]
const toolExpansionOptions: Array<{ label: string; value: ToolExpansionMode }> = [
  { label: '自动', value: 'auto' },
  { label: '展开', value: 'expanded' },
  { label: '折叠', value: 'collapsed' }
]
const sidebarDisplayOptions: Array<{ label: string; value: SidebarDisplayMode }> = [
  { label: '常驻', value: 'persistent' },
  { label: '自动收起', value: 'auto' }
]
const markdownFontOptions: Array<{ label: string; value: MarkdownFontStyle }> = [
  { label: '无衬线', value: 'sans' },
  { label: '衬线', value: 'serif' },
  { label: '自定义', value: 'custom' }
]
const motionOptions: Array<{ label: string; value: MotionPreference }> = [
  { label: '完整', value: 'full' },
  { label: '减少', value: 'reduced' }
]
const avatarStyleOptions: Array<{ label: string; value: AvatarStyle }> = [
  { label: '标识', value: 'pixel' },
  { label: '圆形', value: 'circle' },
  { label: '隐藏', value: 'hidden' }
]
const userAlignmentOptions: Array<{ label: string; value: UserMessageAlignment }> = [
  { label: '右侧', value: 'right' },
  { label: '同侧', value: 'left' }
]

const uiFontSizeModel = computed({
  get: () => appearanceSettings.uiFontSize.value,
  set: (value: number | string | null | undefined) => appearanceSettings.setUiFontSize(value)
})

const codeFontSizeModel = computed({
  get: () => appearanceSettings.codeFontSize.value,
  set: (value: number | string | null | undefined) => appearanceSettings.setCodeFontSize(value)
})

const uiFontSizeSliderModel = computed({
  get: () => [uiFontSizeModel.value],
  set: (value: number[] | undefined) => appearanceSettings.setUiFontSize(value?.[0])
})

const codeFontSizeSliderModel = computed({
  get: () => [codeFontSizeModel.value],
  set: (value: number[] | undefined) => appearanceSettings.setCodeFontSize(value?.[0])
})

const customUiFontModel = computed({
  get: () => appearanceSettings.customUiFontFamily.value,
  set: (value: string | number) => appearanceSettings.setCustomUiFontFamily(String(value))
})
const customCodeFontModel = computed({
  get: () => appearanceSettings.customCodeFontFamily.value,
  set: (value: string | number) => appearanceSettings.setCustomCodeFontFamily(String(value))
})
const customMarkdownFontModel = computed({
  get: () => appearanceSettings.customMarkdownFontFamily.value,
  set: (value: string | number) => appearanceSettings.setCustomMarkdownFontFamily(String(value))
})
const customActivityTextModel = computed({
  get: () => appearanceSettings.customActivityText.value,
  set: (value: string | number) => appearanceSettings.setCustomActivityText(String(value))
})
</script>

<template>
  <ScrollArea class="general-page-scroll">
    <div class="general-page">
      <header class="general-page__header">
        <div>
          <p class="general-page__eyebrow">Personalization</p>
          <h1 class="general-page__title">个性化</h1>
          <p class="general-page__subtitle">调整应用主题与阅读体验，设置会即时生效并保存在本机。</p>
        </div>
      </header>

      <BasePanel title="主题" eyebrow="Theme">
        <div class="general-field">
          <div class="general-field__copy">
            <strong>主题模式</strong>
            <span>选择浅色、深色，或跟随系统外观。</span>
          </div>
          <BaseSegmentedControl
            label="主题模式"
            :model-value="themeMode"
            :options="themeOptions"
            @update:model-value="setThemeMode"
          />
        </div>
      </BasePanel>

      <BasePanel title="聊天界面" eyebrow="Chat">
        <div class="font-size-grid">
          <div class="general-field">
            <div class="general-field__copy">
              <strong>界面密度</strong>
              <span>调整消息间距与聊天区域留白。</span>
            </div>
            <BaseSegmentedControl
              label="界面密度"
              :model-value="appearanceSettings.density.value"
              :options="densityOptions"
              @update:model-value="appearanceSettings.setDensity"
            />
          </div>
          <div class="general-field personalization-field--divided">
            <div class="general-field__copy">
              <strong>内容宽度</strong>
              <span>同步调整消息时间线与输入框的最大宽度。</span>
            </div>
            <BaseSegmentedControl
              label="聊天内容宽度"
              :model-value="appearanceSettings.chatContentWidth.value"
              :options="contentWidthOptions"
              @update:model-value="appearanceSettings.setChatContentWidth"
            />
          </div>
          <div class="general-field personalization-field--divided">
            <div class="general-field__copy">
              <strong>消息时间</strong>
              <span>控制用户和智能体消息时间的显示方式。</span>
            </div>
            <BaseSegmentedControl
              label="消息时间显示方式"
              :model-value="appearanceSettings.messageTimeDisplay.value"
              :options="messageTimeOptions"
              @update:model-value="appearanceSettings.setMessageTimeDisplay"
            />
          </div>
          <div class="general-field personalization-field--divided">
            <div class="general-field__copy">
              <strong>活动状态</strong>
              <span>控制智能体工作时指示器和状态文案的显示。</span>
            </div>
            <BaseSegmentedControl
              label="活动状态显示方式"
              :model-value="appearanceSettings.activityDisplay.value"
              :options="activityDisplayOptions"
              @update:model-value="appearanceSettings.setActivityDisplay"
            />
          </div>
          <div class="general-field personalization-field--divided">
            <div class="general-field__copy">
              <strong>活动指示器</strong>
              <span>选择默认工作指示器样式；扩展自定义指示器保持优先。</span>
            </div>
            <BaseSegmentedControl
              label="活动指示器样式"
              :model-value="appearanceSettings.activityIndicatorStyle.value"
              :options="activityIndicatorOptions"
              @update:model-value="appearanceSettings.setActivityIndicatorStyle"
            />
          </div>
          <div class="personalization-field--divided">
            <SettingsTextField
              v-model="customActivityTextModel"
              label="自定义活动文字"
              description="留空时使用扩展文案或系统动态状态。"
              placeholder="例如：正在思考"
            />
          </div>
          <div class="general-field personalization-field--divided">
            <div class="general-field__copy">
              <strong>工具调用</strong>
              <span>设置工具调用内容的默认展开状态。</span>
            </div>
            <BaseSegmentedControl
              label="工具调用默认状态"
              :model-value="appearanceSettings.toolExpansion.value"
              :options="toolExpansionOptions"
              @update:model-value="appearanceSettings.setToolExpansion"
            />
          </div>
          <div class="general-field personalization-field--divided">
            <div class="general-field__copy">
              <strong>侧栏显示</strong>
              <span>常驻显示，或在窗口变窄时自动收起。</span>
            </div>
            <BaseSegmentedControl
              label="侧栏显示方式"
              :model-value="appearanceSettings.sidebarDisplay.value"
              :options="sidebarDisplayOptions"
              @update:model-value="appearanceSettings.setSidebarDisplay"
            />
          </div>
          <div class="general-field personalization-field--divided">
            <div class="general-field__copy">
              <strong>Markdown 字体</strong>
              <span>选择智能体回复正文的字体风格。</span>
            </div>
            <BaseSegmentedControl
              label="Markdown 字体风格"
              :model-value="appearanceSettings.markdownFontStyle.value"
              :options="markdownFontOptions"
              @update:model-value="appearanceSettings.setMarkdownFontStyle"
            />
          </div>
          <div
            v-if="appearanceSettings.markdownFontStyle.value === 'custom'"
            class="personalization-field--divided"
          >
            <SettingsTextField
              v-model="customMarkdownFontModel"
              label="自定义 Markdown 字体"
              description="输入已安装的字体名称或 CSS 字体栈。"
              placeholder='例如：Inter, "Source Han Sans SC", sans-serif'
            />
          </div>
          <div class="general-field personalization-field--divided">
            <div class="general-field__copy">
              <strong>界面动效</strong>
              <span>减少非必要的过渡与动画；系统减弱动效设置始终优先。</span>
            </div>
            <BaseSegmentedControl
              label="界面动效"
              :model-value="appearanceSettings.motion.value"
              :options="motionOptions"
              @update:model-value="appearanceSettings.setMotion"
            />
          </div>
          <div class="general-field personalization-field--divided">
            <div class="general-field__copy">
              <strong>头像样式</strong>
              <span>选择消息头像的外观，或完全隐藏。</span>
            </div>
            <BaseSegmentedControl
              label="消息头像样式"
              :model-value="appearanceSettings.avatarStyle.value"
              :options="avatarStyleOptions"
              @update:model-value="appearanceSettings.setAvatarStyle"
            />
          </div>
          <div class="general-field personalization-field--divided">
            <div class="general-field__copy">
              <strong>用户消息对齐</strong>
              <span>用户消息靠右显示，或与智能体回复同侧。</span>
            </div>
            <BaseSegmentedControl
              label="用户消息对齐"
              :model-value="appearanceSettings.userMessageAlignment.value"
              :options="userAlignmentOptions"
              @update:model-value="appearanceSettings.setUserMessageAlignment"
            />
          </div>
          <div class="personalization-field--divided">
            <SettingsSwitchField
              :model-value="appearanceSettings.wrapCode.value"
              title="代码自动换行"
              description="长代码行自动折行，避免横向滚动。"
              @update:model-value="appearanceSettings.setWrapCode"
            />
          </div>
        </div>
      </BasePanel>

      <BasePanel title="字体大小" eyebrow="Typography">
        <template #actions>
          <BaseButton size="sm" variant="secondary" @click="appearanceSettings.resetFontSizes">
            <template #icon><RotateCcw :size="14" /></template>
            重置字体
          </BaseButton>
        </template>
        <div class="font-size-grid">
          <label class="font-size-field">
            <span class="font-size-field__copy">
              <strong>UI 字体大小</strong>
              <small>当前 {{ uiFontSizeModel }}px</small>
            </span>
            <span class="font-size-field__control">
              <Slider
                v-model="uiFontSizeSliderModel"
                :min="appearanceSettings.uiFontSizeRange.min"
                :max="appearanceSettings.uiFontSizeRange.max"
                :step="appearanceSettings.uiFontSizeRange.step"
              />
              <input
                v-model.number="uiFontSizeModel"
                :min="appearanceSettings.uiFontSizeRange.min"
                :max="appearanceSettings.uiFontSizeRange.max"
                :step="appearanceSettings.uiFontSizeRange.step"
                type="number"
              />
            </span>
          </label>

          <div class="personalization-field--divided">
            <SettingsTextField
              v-model="customUiFontModel"
              label="自定义 UI 字体"
              description="留空时使用应用默认无衬线字体。"
              placeholder='例如：Inter, "Source Han Sans SC", sans-serif'
            />
          </div>

          <label class="font-size-field">
            <span class="font-size-field__copy">
              <strong>代码字体大小</strong>
              <small>当前 {{ codeFontSizeModel }}px</small>
            </span>
            <span class="font-size-field__control">
              <Slider
                v-model="codeFontSizeSliderModel"
                :min="appearanceSettings.codeFontSizeRange.min"
                :max="appearanceSettings.codeFontSizeRange.max"
                :step="appearanceSettings.codeFontSizeRange.step"
              />
              <input
                v-model.number="codeFontSizeModel"
                :min="appearanceSettings.codeFontSizeRange.min"
                :max="appearanceSettings.codeFontSizeRange.max"
                :step="appearanceSettings.codeFontSizeRange.step"
                type="number"
              />
            </span>
          </label>

          <div class="personalization-field--divided">
            <SettingsTextField
              v-model="customCodeFontModel"
              label="自定义代码字体"
              description="留空时使用应用默认等宽字体。"
              placeholder='例如：JetBrains Mono, "Source Code Pro", monospace'
            />
          </div>
        </div>
      </BasePanel>
    </div>
  </ScrollArea>
</template>
