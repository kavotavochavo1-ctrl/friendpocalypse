# Проверка зависимостей — 21 октября 2026

Это ограниченная проверка исходников и происхождения файлов, а не гарантия отсутствия вредоносного кода и не независимый аудит.

## Выбранные проекты

- Electron **45.0.0** — https://github.com/electron/electron. Desktop runtime для существующей HTML/JS-игры.
- electron-builder **26.15.3** / electron-updater **6.8.9** — https://github.com/electron-userland/electron-builder. Установщик и обновления из указанного GitHub-репозитория.
- steamworks-ffi-node **0.11.3** — https://github.com/ArtyProf/steamworks-ffi-node, тег v0.11.3, commit `656d89dfbcd191602f4fe50d1a995213522e3753`. Небольшой проект, выбран ради современного ISteamNetworkingSockets с reliable/unreliable и сообщениями больше 1200 байт.
- Koffi — транзитивная FFI-зависимость; точная версия и integrity закреплены в package-lock.json.

Альтернативы: https://github.com/ceifa/steamworks.js (более распространённый JS-wrapper, но legacy P2P, unreliable ≤1200 байт); https://github.com/code-disaster/steamworks4j (Java; потребовал бы дополнительный runtime и мост). https://github.com/alexanderthurn/steam-electron-build просмотрен как готовый пример, не установлен и не исполняется как зависимость игры.

## Выполнено

1. Прочитан npm postinstall `steamworks-ffi-node`: только вывод инструкций; нет загрузок и запуска сторонних команд.
2. Просмотрены SDK loader, core lifecycle, callbacks, matchmaking, networking, optional overlay. Поиск исполняемого JS по внешним URL, process execution, eval, HTTP, переменным окружения и типичным путям секретов не выявил сторонних загрузчиков или эксфильтрации в выбранных менеджерах. Поиск сам по себе не доказывает безопасность.
3. Исходники Git-тега v0.11.3 собраны TypeScript-компилятором. Все **44 JavaScript-файла dist совпали** с установленным npm-пакетом после нормализации CRLF/LF. Это проверка соответствия, не доказательство корректности исходников.
4. `npm audit --omit=dev`: **0 известных уязвимостей** на момент проверки. `npm audit signatures`: **293 registry signatures проверены**, **45 attestations проверены**. Эти подписи подтверждают происхождение пакетов из registry, а не доверенность поведения.
5. DLL `steam_api64.dll`: действительная Authenticode-подпись **Valve Corp.**; SHA256 `eb17909a76668cf9ae0b92a618a34a50f6c73d3a6787cb4dd8ce36a8b10bfb75`. Источник: https://github.com/alexanderthurn/steam-electron-build/blob/0acde0c2a1683f012622eae96c562fd632b34203/steamworks_sdk/redistributable_bin/win64/steam_api64.dll. Скрипт сборки сверяет хеш и подпись, а runtime сверяет хеш.
6. Неиспользуемый `steam-overlay.node` **не импортируется и исключён из упаковки**. Лаунчер создаёт только нужные JS-менеджеры через `desktop/sdk.cjs`; нативные компоненты: Electron, Koffi и подписанная DLL Valve.
7. Выявлена утечка временного native pointer array в upstream receiveMessages; локальная ограниченная замена в `desktop/main.cjs` освобождает массив через `finally`. Декодирование сообщения использует исходный parser библиотеки.
8. Renderer: sandbox=true, contextIsolation=true, nodeIntegration=false. IPC принимает только известные операции от главного локального окна. URL внешних действий фиксированы. Приватные файлы недоступны через игровой протокол (проверено: 403). Участник комнаты не может прислать хосту команды start/roster/snap/back.

## Границы

- Попытка локального Microsoft Defender scan завершилась `0x80004005`; **антивирусная проверка не выполнена**. Бинарники Koffi/Electron не пересобирались из исходников.
- Сборка не имеет собственного сертификата Windows. Обновления проверяют хеш из GitHub Release metadata и HTTPS; защита от захвата GitHub-аккаунта владельца требует защиты самого аккаунта и подписывания релизов.
- Steam и GitHub получают обычный сетевой трафик соответствующих сервисов. Существующая игра отправляет результаты забегов в Supabase (`net.js`); это прежнее поведение. Голоса, музыка и изображения упакованы локально. Браузерный режим загружает Trystero с CDN; Steam-режим его не использует.
- Нужен дополнительный реальный тест на двух Steam-аккаунтах через разные сети. Проверены настоящее создание лобби/список друзей и два игровых renderer с искусственными потерями и перестановкой снапшотов.
