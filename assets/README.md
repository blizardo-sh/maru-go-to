# Иллюстрации

## Кот-помощник: первый вариант

- Файл: [mascot-neutral-v1.png](mascot/mascot-neutral-v1.png).
- Статус: концепт для обсуждения, конкретный рисунок ещё не утверждён.
- Назначение: спокойная нейтральная реакция в учебном интерфейсе.
- Создан встроенным инструментом ImageGen 20 октября 2026 года.
- Фон: прозрачный PNG с альфа-каналом. Поза и силуэт визуально проверены; читаемость на реальном экране телефона ещё не проверялась.
- Исходный файл сохранён без изменений; байты PNG скопированы в проект.
- Дополнительно созданы 8 состояний: моргание, приветствие, размышление, радость, поддержка, объяснение, стоя и отдых лёжа. Все файлы перечислены в [manifest.json](mascot/manifest.json).
- [Галерея с движением](mascot/preview.html), [рекомендации по анимации](mascot/ANIMATION.md) и [точные запросы для вариантов](mascot/PROMPTS.md) подготовлены для реализующего агента.
- Проверены загрузка всех 9 PNG в браузере, переключение поз, отключение движения и автоматическое моргание. Проверка на физическом телефоне не проводилась.

## Точный запрос генерации

```text
Use case: stylized-concept. Asset type: original full-body cat mascot for a calm, cozy Japanese-language learning web application, mascot-neutral-v1. Primary request: one small, very cute original anime-style cat study companion with warm cream fur, soft terracotta ear interiors, a tiny muted sage neck scarf, simple round shapes, relaxed friendly eyes, subtle blush, and a gentle encouraging smile. Sitting upright, front three-quarter view, holding one small blank study card. Clean hand-drawn 2D illustration, restrained warm pastel colors, clean soft outlines and minimal cel shading. Clearly readable silhouette and expression when displayed at 96 px. Composition: exactly one character, whole body and tail visible, centered with generous transparent padding. Background: genuinely transparent alpha, no scene, no ground plane, no cast shadow. No text, letters, logos, watermark, UI, borders, labels, grid or additional characters. Original character, not based on any existing anime franchise. The result is a review concept for an agreed cat mascot; do not make an interface mockup.
```
