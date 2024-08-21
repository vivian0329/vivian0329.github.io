<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link rel="shortcut icon" href="[your-favicon-url]">
    <title>Meet Shiro</title>
    <style>
        body {
            font-family: "Arial", sans-serif;
            margin: 0;
            padding: 0;
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            background-image: url('Shiro 4.jpg');
            background-size: cover;
            background-position: center;
            background-repeat: no-repeat;
            color: #ee9ce2;
            white-space: pre; /* 保留空白和换行符 */
            cursor: url('Shiro 2.JPG'), auto; /* 自定义光标 */
        }

        .container {
            width: 90%;
            height: 90%;
            background-color: rgba(255, 255, 255, 0.8);
            padding: 20px;
            border-radius: 20px;
            box-shadow: 0 0 20px rgba(237, 0, 0, 0.2);
            display: flex;
            flex-direction: row;
            transition: transform 0.3s ease-in-out; /* 添加过渡效果 */
        }

        .container:hover {
            transform: scale(1.02); /* 当鼠标悬停时，略微放大容器 */
        }

        h1 {
            color: #e63946;
            font-size: 36px;
        }

        p {
            font-size: 18px;
            line-height: 1.6;
            color: #023047;
        }

        .text-content {
            flex: 2;
            padding-right: 20px;
            overflow-y: auto;
        }

        .media {
            flex: 1;
            max-height: 100%;
            overflow-y: auto;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: flex-start;
        }

        .media img, .media video {
            max-width: 100%;
            margin-bottom: 20px;
            border-radius: 10px;
            transition: transform 0.3s ease, box-shadow 0.3s ease;
            border: 5px solid #e63946;
        }

        .media img:hover, .media video:hover {
            transform: scale(1.05);
            box-shadow: 0 0 20px rgba(0, 0, 0, 0.3);
        }

        .media video {
            cursor: pointer;
        }

        #goldie {
            position: fixed;
            top: 6vh;
            z-index: 11;
            right: 3vw;
            height: 18vh;
            transition: height 3s ease-in;
        }

        #goldie:hover {
            height: 60vh;
        }

        .runofthe {
            color: red;
            font-family: Garamond;
        }

        img {
            border-left: .15vw solid black;
        }

        #Shiro2 {
            position: absolute;
            top: 90vh;
            right: 0px;
            width: 30vw;
            height: 90vw;
            z-index: 10;
            opacity: .6;
        }

        #Shiro3 {
            position: absolute;
            top: 600vh;
            left: -45vw;
            width: 180vw;
            height: 45vw;
            z-index: 10;
            opacity: .6;
        }

        #Shiro4 {
            position: absolute;
            top: 450vh;
            left: 45vw;
            width: 6vw;
            height: 3vw;
            z-index: 10;
            opacity: .6;
        }

        video {
            position: absolute;
            width: 30vw;
            border-radius: 30% 60% 15% 10%;
            top: 15vh;
            left: 6vw;
        }

        #willothe {
            position: absolute;
            color: blue;
            background-color: #004D39;
            text-shadow: 18px -300px 12px black;
            border: 60px dotted black;
            width: 9vw;
            height: 2700px;
            right: 600px;
            top: 300px;
            font-size: 75vh;
            font-family: Helvetica;
            text-align: center;
            line-height: 75vh;
        }

        #goingto {
            position: fixed;
            font-size: 12vw;
            top: 30vh;
            left: 50vw;
            z-index: 100;
            line-height: 9vw;
            font-style: italic;
        }

    </style>
</head>
<body>
    <div class="container">
        <div class="text-content">
            <h1>Hello everyone, I'm Shiro!</h1>
            <p>
                I’m a 1-year-old Bichon Frise, fluffy and white like a little cloud. I love running around the house, especially chasing my favorite toy ball—that’s the highlight of my day. I also enjoy playing with my family; they always give me lots of love and care.
            </p>
            <p>
                Even though I’m still young, I’ve learned a lot. I can sit, shake hands, and wait patiently for my meals. My favorite food is chicken, and I can’t help but wag my tail whenever I smell it.
            </p>
            <p>
                I enjoy making new friends, especially with other dogs at the park. I might be a bit mischievous at times, but I know everyone loves me because I always bring smiles and joy to their lives.
            </p>
            <p>
                Shiro is a <a href="https://www.akc.org/dog-breeds/bichon-frise/" target="_blank">Bichon Frise</a>, a fluffy and friendly breed.
            </p>
            <p>
                Learn more about the Bichon Frise breed on the <a href="https://www.akc.org/dog-breeds/bichon-frise/" target="_blank">AKC website</a>.
            </p>
            <div>[Any <a id="custom-link" href="https://www.example.com">other</a> blue bell]</div>

            <div class="runofthe" id="goingto">gonna</div>
            <div id="goingtobedinthestickysummer" class="runofthe">going</div>
            <div class="runofthe" id="goingtobed">full</div>

            <div id="cuernocueva">Once upon a midnight <span id="dear">dreary as I pondered</span> weak and weary</div>
        </div>
        <div class="media">
            <video src="Shiro.MP4" controls></video>
            <img id="Shiro2" src="Shiro 2.JPG" alt="Shiro Photo 1">
            <img id="goldie" src="Shiro 3.JPG" alt="Shiro Photo 2">
        </div>
    </div>
</body>
</html>
