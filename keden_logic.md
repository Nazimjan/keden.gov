# Логика заполнения декларации (Preliminary Information - PI) на keden.kgd.gov.kz

Анализ HAR-файла показывает, что процесс заполнения предварительной информации (ПИ) состоит из последовательности API-запросов. Все запросы выполняются к `https://keden.kgd.gov.kz/api/v1/...`.

## 1. Авторизация и Заголовки
Для успешного выполнения запросов необходимы следующие заголовки (извлекаются из браузера/сессии):
- `Cookie`: Сессионные куки.
- `X-XSRF-TOKEN`: Токен защиты от CSRF (обычно берется из куки `XSRF-TOKEN` или meta-тега).
- `Content-Type`: `application/json`

## 2. Последовательность действий

### Шаг 1: Создание/Обновление основной информации (PI Declaration)
Вначале создается или обновляется "шапка" декларации. В HAR-файле зафиксирован `PUT` запрос (обновление черновика).

**Endpoint:** `PUT /api/v1/pideclaration/pi-declaration/{ID}`  
*Где `{ID}` - уникальный идентификатор декларации (guid).*

**Request Body (JSON):**
```json
{
  "id": "01KFZKTYQC082GHRGA6Y8ZFBXV",
  "vehicleType": {
    "id": 2050,
    "code": "Auto",
    "dictionaryDto": { "code": "pi_vehicle_type_classifier" }
  },
  "directionType": { "id": 1, "code": "PI" }, // Preliminary Information
  "movementType": { "id": 4, "code": "TR" },  // Transit
  "customs": {
    "id": 274,
    "code": "57505" // Код таможенного поста (Нур Жолы)
  },
  "referenceCode": "ASQNHY7J", // Справочный номер
  "type": "PI",
  "presentationFeatures": [
    {
       "feature": { "code": "06" } // Таможенная процедура (Транзит)
    }
  ]
}
```

### Шаг 2: Создание товарной партии (Consignment)
После создания декларации создается партия товаров.

**Endpoint:** `POST /api/v1/pideclaration/consignment`

**Request Body:**
```json
{
  "preliminaryId": "01KFZKTYQC082GHRGA6Y8ZFBXV", // ID декларации из Шага 1
  "indexOrder": 0
}
```

**Response:**
Возвращает объект, содержащий `id` партии (consignmentId), например `01KFZKW1N67XZEZ4A85JXCM6TH`.

### Шаг 3: Добавление товаров (Bulk Import / Import Via Form)
Товары добавляются массово через специальный эндпоинт загрузки формы.

**Endpoint:** `POST /api/v1/pideclaration/product/import-via-form?consignmentId={CONSIGNMENT_ID}`

**Request Body (Array of Objects):**
```json
[
  {
    "guid": "0_3p2p9zinin65f4eq3nn0tk", // Временный FE-GUID
    "tnvedCode": "6402992900",           // Код ТНВЭД
    "commercialName": "ОБУВЬ",           // Наименование
    "cargoSeatQuantity": "404",          // Количество мест
    "packagingPalletsInfoPackageQuantity": "404",
    "grossWeight": "3970",               // Вес брутто
    "cost": "6060",                      // Стоимость
    "currencyCode": "USD",               // Валюта
    "packageType": "1",
    "packagingPalletsInfoPackageTypeCode": "PK", // Код упаковки
    "packagingPalletsInfoPackageInfoType": "0",
    "prohibitionFree": "1"
  },
  {
    "guid": "1_xbudupmmq8intjhtkxo1np",
    "tnvedCode": "3304100091",
    "commercialName": "Цвет волос",
    "grossWeight": "3472",
    "cost": "1920",
    ...
  }
]
```
*Примечание: В анализируемом файле отсутствует явное поле `netWeight` (Вес нетто) в payload.*

### Шаг 4: Добавление контрагентов (Участников)
Добавление Перевозчика (Carrier), Отправителя и Получателя.

#### Добавление Перевозчика
**Endpoint:** `POST /api/v1/pideclaration/counteragent` (или копирование через PATCH)

**Query Params:** `targetId={ID}&targetType=PRELIMINARY&type=CARRIER`

**Пример данных (из ответа GET, структура для POST аналогична):**
```json
{
  "type": "CARRIER",
  "legal": { "bin": "250140031608", "nameRu": "ТОО SENIM-PARTS" },
  "targetId": "01KFZKTYQC082GHRGA6Y8ZFBXV",
  "representatives": [
     { "firstName": "САБИТЖАН", "lastName": "САИТОВ", "iin": "790921300248", "role": "1 - водитель..." }
  ],
  "addresses": [ ... ]
}
```

### Шаг 5: Прочие действия
В логах замечены запросы к `wee-info` и `documents`.
*   **Documents**: `GET/POST /api/v1/pideclaration/documents/preliminary/{ID}` - работа с документами.
*   **Wee-info**: `GET /api/v1/pideclaration/product/wee-info/{ID}` - получение информации о весах/стоимостях (вероятно, расчет итогов).

## Сводная таблица потоков данных

| Действие | Метод | URL (относительный) | Откуда данные (Request) | Куда данные (Response) |
| :--- | :--- | :--- | :--- | :--- |
| **Сохранение Декларации** | PUT | `/pideclaration/pi-declaration/{id}` | Поля формы (Тип ТС, Таможня, Направление) | Обновленный объект декларации |
| **Создание Партии** | POST | `/pideclaration/consignment` | ID декларации | ID партии (`id`) |
| **Добавление товаров** | POST | `/pideclaration/product/import-via-form` | Массив товаров, ID партии (в query) | Статус операции (и созданные ID товаров) |
| **Инфо о товаре** | GET | `/pideclaration/product/{id}` | ID товара | Полные данные товара (`grossWeight`, `tnved`, `packagingInfo`) |
