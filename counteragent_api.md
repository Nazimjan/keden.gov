
# API: Полная структура запроса и ответа для Контрагентов

## Описание

Этот документ описывает структуру API-взаимодействия при работе с контрагентами: Перевозчиком (Carrier), Отправителем (Consignor), Получателем (Consignee) и Декларантом (Declarant).

**Endpoint:** `POST https://keden.kgd.gov.kz/api/v1/pideclaration/counteragent`

---

## 1. ПЕРЕВОЗЧИК (Carrier)

**Резидент РК (Юридическое Лицо)**

### 1.1 Запрос (Request)

**Method:** `POST`
**URL:** `https://keden.kgd.gov.kz/api/v1/pideclaration/counteragent`
**Headers:** `Content-Type: application/json`, `Authorization: Bearer ...`

**Payload (Body):**

```json
{
  "entityType": "LEGAL",
  "legal": {
    "bin": "250140031608",
    "nameRu": "Товарищество с ограниченной ответственностью \"SENIM-PARTS\"",
    "shortNameRu": "ТОО \"SENIM-PARTS\""
  },
  "addresses": [
    {
      "addressType": {
        "id": 2014,
        "code": "1",
        "kk": "Тіркеу мекенжайы",
        "ru": "Адрес регистрации",
        "en": "Registration address"
      },
      "country": {
        "id": 113,
        "numericCode": "398",
        "letterCodeShort": "KZ",
        "shortNameRu": "КАЗАХСТАН"
      },
      "region": "область Жетісу",
      "street": "улица Сергазы Беспаев",
      "postalCode": "041300",
      "house": "46/2",
      "district": "Панфиловский район",
      "city": "город Жаркент"
    }
  ],
  "contacts": [],
  "type": "CARRIER",
  "targetId": "01KFZKTYQC082GHRGA6Y8ZFBXV", // ID Декларации (PRELIMINARY)
  "targetType": "PRELIMINARY",
  "roleCounteragent": {
    "id": 2031,
    "code": "CARRIER",
    "ru": "Перевозчик ЕС"
  }
}
```

---

## 2. ОТПРАВИТЕЛЬ (Consignor)

**Нерезидент (Иностранное Юр. лицо)**

### 2.1 Запрос (Request)

**Payload:**

```json
{
  "entityType": "NON_RESIDENT_LEGAL",
  "nonResidentLegal": {
    "nameRu": "YIWU TAMING TRADING CO.,LTD"
  },
  "addresses": [
    {
      "addressType": { "id": 2014, "code": "1", "ru": "Адрес регистрации" },
      "country": {
        "id": 44,
        "numericCode": "156",
        "letterCodeShort": "CN",
        "shortNameRu": "КИТАЙ"
      },
      "district": "KHORGOS"
    }
  ],
  "contacts": null,
  "nonResidentPerson": null,
  "type": "CONSIGNOR",
  "sellerEqualIndicator": true,
  "buyerEqualIndicator": false,
  "targetId": "01KFZKW1N67XZEZ4A85JXCM6TH", // Внимание: ID Партии (CONSIGNMENT)
  "targetType": "CONSIGNMENT",
  "indexOrder": 0
}
```

---

## 3. ПОЛУЧАТЕЛЬ (Consignee)

**Нерезидент**

### 3.1 Запрос (Request)

**Payload:**

```json
{
  "entityType": "NON_RESIDENT_LEGAL",
  "nonResidentLegal": {
    "nameRu": "OMAR NOMAN LTD"
  },
  "addresses": [
    {
      "country": { "id": 11, "letterCodeShort": "AF", "shortNameRu": "АФГАНИСТАН" }
    }
  ],
  "type": "CONSIGNEE",
  "sellerEqualIndicator": false,
  "buyerEqualIndicator": true,
  "targetId": "01KFZKW1N67XZEZ4A85JXCM6TH", // Внимание: ID Партии (CONSIGNMENT)
  "targetType": "CONSIGNMENT"
}
```

---

## 4. ДЕКЛАРАНТ (Declarant)

**Резидент РК**

### 4.1 Запрос (Request)

**Payload:**

```json
{
  "entityType": "LEGAL",
  "legal": {
    "bin": "...",
    "nameRu": "Товарищество с ограниченной ответственностью \"EKAY LTD\""
  },
  "type": "DECLARANT",
  "targetId": "01KFZKTYQC082GHRGA6Y8ZFBXV", // ID Декларации (PRELIMINARY)
  "targetType": "PRELIMINARY"
}
```

---

## 5. Общая Структура Ответа (Response)

Структура ответа одинакова для всех типов контрагентов. Различается только поле `legal` (для Резидентов) или `nonResidentLegal` (для Нерезидентов).

**Status:** `200 OK`

### 5.1 Общий вид тела ответа

```json
{
  "id": "01KFZM38WSKK5G0N85K5PXPZB5", // Новый ID контрагента
  "type": "CARRIER", // или CONSIGNOR, CONSIGNEE, DECLARANT
  "entityType": "LEGAL", // или NON_RESIDENT_LEGAL
  
  // Для Резидентов (Entity Type = LEGAL)
  "legal": {
    "id": "...", 
    "bin": "250140031608",
    "nameRu": "Товарищество ...",
    "shortNameRu": "ТОО ..."
  },

  // Для Нерезидентов (Entity Type = NON_RESIDENT_LEGAL)
  "nonResidentLegal": { // Может быть null, если LEGAL
    "nameRu": "YIWU TAMING TRADING CO.,LTD" 
  },

  "targetId": "...", // ID родительской сущности (Декларации или Партии)
  "targetType": "PRELIMINARY", // или CONSIGNMENT
  
  "roleCounteragent": {
    "id": 2031,
    "code": "CARRIER", // Код роли из справочника
    "ru": "Перевозчик ЕС"
  },
  
  "addresses": [ ... ], // Массив адресов, идентичен запросу
  "counteragentName": "Товарищество ...", // Дублирует имя
  "sellerEqualIndicator": false,
  "buyerEqualIndicator": false,
  "indexOrder": 0
}
```

---

## Сводная таблица типов

| Тип | Target Type | Target ID | Entity Type (обычно) | Доп. флаги |
| :--- | :--- | :--- | :--- | :--- |
| **CARRIER** (Перевозчик) | PRELIMINARY | ID Декларации | LEGAL (Resident) | - |
| **DECLARANT** (Декларант) | PRELIMINARY | ID Декларации | LEGAL (Resident) | - |
| **CONSIGNOR** (Отправитель) | CONSIGNMENT | ID Партии | NON_RESIDENT_LEGAL | `sellerEqualIndicator: true` |
| **CONSIGNEE** (Получатель) | CONSIGNMENT | ID Партии | NON_RESIDENT_LEGAL | `buyerEqualIndicator: true` |
| **FILLER_DECLARANT** | PRELIMINARY | ID Декларации | (Person/User info) | - |
