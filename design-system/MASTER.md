# Keden Extension Design System (Glassmorphism)

## 🎨 Color Palette

| Role | Hex | Alpha | Use Case |
| :--- | :--- | :--- | :--- |
| Background | #09090b | 100% | Deep space background |
| Glass Base | #ffffff | 3% | Default component background |
| Glass Strong | #ffffff | 8% | Hover/Primary state |
| Glass Border | #ffffff | 12% | Subtle element outlines |
| Primary Accent | #3b82f6 | 100% | Primary buttons, links |
| Success | #10b981 | 100% | Validated fields, positive status |
| Error | #ef4444 | 100% | Invalid fields, errors |
| Warning | #f59e0b | 100% | Pending/Incomplete status |

## 📐 Layout & Spacing

- **Border Radius**: XL: 24px, L: 14px, M: 8px
- **Padding**: 24px for containers, 12-16px for items
- **Max Width**: 380px (Initial), 1080px (Expanded/Tab)

## 🖋️ Typography (Plus Jakarta Sans)

- **H1**: 22px, Bold, -0.8px letter-spacing (Linear gradient text)
- **H2/H3**: 16px, Semi-bold, -0.5px letter-spacing
- **Body**: 14px, Medium
- **Muted**: 12px, Regular, 60% opacity

## ✨ Effects

- **Backdrop Blur**: 30px (Saturate 180%)
- **Shadow**: 0 25px 50px -12px rgba(0, 0, 0, 0.7)
- **Transitions**: 0.3s cubic-bezier(0.16, 1, 0.3, 1)

## 🚫 Avoid (Anti-patterns)

- Opaque backgrounds
- Hard borders
- Generic blue buttons without gradients
- Layout-shifting hover effects
