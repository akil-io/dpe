# DPE Framework - Data Process Engine

Основное функциональное назначение деплой и управление запущенным кодом 
в сети узлов запущенных на различных платформах, таких как window, unix,
 android, ios, chrome app, chrome plugin. Поддерживает создание функций
на языках JavaScript, Python, Java, C++

Архитектурно состоит из следующих частей:
1. Хост-сервис - обвязка для запуска и управления фоновым сервисом
    который содержит в себе ядро и загруженные приложения
2. Ядро - набор связанных модулей исполняющихся в общем контексте
    обеспечивающих базовые функциональные возможности сервиса и основной
    жихненный цикл приложения
3. Приложение - зависимый от конкретного ядра набор функций определяющих
    бизнес-логику и выполняющих какие-то полезные действия
4. Компонент - составная часть ядра и приложений, по сути каждая
    отдельная функция которая может быть вызвана из вне
5. Сигнал - запрос на исполнение функций в системе, представляет собой
    JSON объект, в котором каждый ключ это имя функции которую необходимо
    вызвать. Также содержит мета-данные начинающиеся с префикса _ и теги
    начинающиеся с префикса @
6. Процесс - набор функций исполняющихся в определенном порядке для 
    достижения некоторой цели в общем контексте исполнения
7. Ресурс - объект данных в общем контексте процесса
    
# Как начать

1. Установить глобально npm пакет с фреймворком

```bash
npm install -g dpe
```

2. Загрузить подходящее ядро, например доступное по умолчанию для
    локальной разработки https://git.akil.io/scm/dpe/default.git

3. Сконфигурировать сервис в системе (вызвать в любой директории)

```bash
sudo dpe service configure
```

4. Запустить сервис с указанным ядром

```bash
sudo dpe service start ./path/to/core/_init.signal.json
```
5. Создать приложение в требуемой директории

```bash
dpe init
```

6. Создать *.js файл с функцией

```bash
touch test.js
```

содержимое test.js
```javascript
module.exports = function (env, args, callback) {
    console.log('HELLO WORLD!');
    callback(null, true);
};
```

7. Добавить его в dpe.json в этой же директории, файл должен выглядеть 
    следующим образом
    
```javascript
{
  "test": {
    "@define": true,
    "file": "./test.js"
  }
}
```

8. Добавить приложение в сервис (исполнять в директории приложения)

```bash
dpe app add ./
```

9. Собрать функцию в сервисе (разрешаются зависимости, выполняется 
    наследование, подключаются триггеры и устанавливаются нужные 
    соединения)
    
```bash
dpe app build test
```

10. Вызвать функцию

```bash
dpe app call test
```

# FAQ
1. Как передать аргумент в функцию - dpe app call test ./arg.json
2. Как определить порядок вызова функций в сигнале

```javascript
{
    "A": {
        "arg1": "test"
    },
    "B": {
        "@target": true,
        "arg1": "$A",
        "arg2": 100
    }
}
```

В данном случае мы помещаем результат исполнения функции в одноименный 
ресурс, а после читаем его при следующем вызове. Функции содержащие в 
аргументах ресурсы не будут исполнены до тех пор пока ресурс не будет 
определен.

3. Как динамически определять порядок исполнения функций

Вариант первый
```javascript
{
    "A": {
        "@observer": true
    },
    "B": {}
    "C": {}
}
```

После каждого вызова функции решение о следующем действии принимает A

Вариант второй с триггерами
{
    "A": {
        "@after": "C"
    },
    "B": {
        "@wrap": "C"
    },
    "C": {}
}

4. Как получить состояние сигнала или процесса

```bash
dpe cli signal signal.json
```

```javascript
{
    _sid: <SID>,
    _pid: <PID>,
    "@process.state": "*"
}
```
```javascript
{
    _sid: <SID>,
    _pid: <PID>,
    "@signal.state": "*"
}
```

В теге @state указывается либо * для полного состояния, либо массив 
конкретных ключей, для сигнала это
signal.status
signal.history
для процесса
process.$<resource_name>
process.$<state>
process.status

5. Как остановить исполнение процесса

```javascript
{
    _sid: <SID>,
    _pid: <PID>,
    "@process.action": "kill"
}
```
