export { default as Button } from './Button.vue'

export interface ButtonVariants {
  variant?: 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost' | 'link'
  size?: 'default' | 'sm' | 'lg' | 'icon' | 'icon-sm' | 'icon-lg'
}

export function buttonVariants(options: ButtonVariants = {}): string {
  const variant = options.variant ?? 'default'
  const size = options.size ?? 'default'
  return `ui-button ui-button--${variant} ui-button--${size}`
}
