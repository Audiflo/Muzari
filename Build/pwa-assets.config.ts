import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config'

export default defineConfig({
    preset: {
        ...minimal2023Preset,
        transparent: {
            sizes: [64, 192, 512],
            favicons: [],
            padding: 0
        },
        maskable: {
            ...minimal2023Preset.maskable,
            padding: 0
        },
        apple: {
            ...minimal2023Preset.apple,
            padding: 0
        }
    },
    images: 'public/muzari-maskable.svg',
    headLinkOptions: {
        resolveSvgName: () => 'muzari-squircle.svg'
    }
})
