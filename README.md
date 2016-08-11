# DPE Framework - Data Process Engine

Основное функциональное назначение деплой и управление запущенным кодом 
в сети узлов запущенных на различных платформах, таких как window, unix,
 android, ios, chrome app, chrome plugin. Поддерживает создание функций
на языках JavaScript, Python, Java, C++.

Архитектурно состоит из следующих частей:

1. Хост-сервис - обвязка для запуска и управления фоновым сервисом
    который содержит в себе ядро и загруженные приложения
1. Ядро - набор связанных модулей исполняющихся в общем контексте
    обеспечивающих базовые функциональные возможности сервиса и основной
    жихненный цикл приложения
1. Приложение - зависимый от конкретного ядра набор функций определяющих
    бизнес-логику и выполняющих какие-то полезные действия
1. Компонент - составная часть ядра и приложений, по сути каждая
    отдельная функция которая может быть вызвана из вне
1. Сигнал - запрос на исполнение функций в системе, представляет собой
    JSON объект, в котором каждый ключ это имя функции которую необходимо
    вызвать. Также содержит мета-данные начинающиеся с префикса _ и теги
    начинающиеся с префикса @
1. Процесс - набор функций исполняющихся в определенном порядке для 
    достижения некоторой цели в общем контексте исполнения
1. Ресурс - объект данных в общем контексте процесса
    
# Как начать

1. Установить глобально npm пакет с фреймворком

    ```bash 
    sudo npm install -g dpe
    ```

1. Сконфигурировать сервис в системе (вызвать в любой директории)

    ```bash
    dpe service configure
    ```
1. Добавить зависимости

    ```bash
    dpe app add -c -g https://domain.com/path/to.git name1
    dpe app add -a -f ../path/to/directory/dpe.json name2
    dpe app add -m -n npm-module-name name3
    ```
    Опции:
     -c, --core добавляет функции с уровнем исполнения ядра (возможно все)
     -m, --module добавляет функции с уровнем исполнения модуля (нормальный)
     -a, --app добавляет функции с уровнем исполнения приложения (песочница)
     
     -g, --git получить зависимость из GIT, должен содержать dpe.json в корне
     -f, --file загрузить локально dpe.json
     -n, --npm получить из NPM
   
1. Запустить сервис с выбранными зависимостями

    ```bash
    dpe service start name1 name2
    ```
     
1. Создать приложение в требуемой директории

    ```bash
    dpe init
    ```
1. Создать *.js файл с функцией

    ```bash
    touch test.js
    ```
содержимое test.js

    ```javascript
    module.exports.A = function (env, args, callback) {
        console.log('HELLO WORLD!');
        callback(null, true);
    };
    ```
1. Добавить его в dpe.json в этой же директории, файл должен выглядеть 
    следующим образом 

    ```javascript
    {
        "test": {
            "@define": true,
            "file": "./test.js"
        }
    }
    ```
1. Добавить приложение в сервис (исполнять в директории приложения)

    ```bash
    dpe app add -a -f ./dpe.json
    ```
    
1. Вызвать функцию

    ```bash
    dpe app call test.A
    ```

# FAQ

1. Как передать аргумент в функцию - dpe app call test -a "argName=argValue"
1. Как определить порядок вызова функций в сигнале

    ```javascript
    {
        "A": {
            "@before": "B"
            "arg1": "test"
        },
        "B": {
            "@target": true,
            "arg2": 100
        }
    }
    ```

В данном случае мы помещаем результат исполнения функции в одноименный 
ресурс, а после читаем его при следующем вызове. Функции содержащие в 
аргументах ресурсы не будут исполнены до тех пор пока ресурс не будет 
определен.

1. Как динамически определять порядок исполнения функций

    ```javascript
    {
        "A": {
            "@after": "C"
        },
        "B": {
            "@wrap": "C"
        },
        "C": {}
    }
    ```

1. Как получить состояние процесса

    ```bash
    dpe app call process.state -a "pid=..."
    dpe app call process.list
    ```

1. Как остановить исполнение процесса

    ```bash
    dpe app call process.kill -a "pid=..."
    ```    
