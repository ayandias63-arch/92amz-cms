const express = require("express");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const crypto = require("crypto");
const dotenv = require("dotenv");
const { createClient } = require("@supabase/supabase-js");

dotenv.config();

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY
);

const app = express();
const PORT = process.env.PORT || 4000;
const HOST = "0.0.0.0";
const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "CAMBIAR_DESPUES";
const sesionesAdmin = new Map();

// ======================================================
// CONFIGURAÇÃO
// ======================================================

const PUBLIC_DIR = path.join(__dirname, "public");
const UPLOADS_DIR = path.join(PUBLIC_DIR, "uploads");

// Criar pastas necessárias
fs.mkdirSync(PUBLIC_DIR, { recursive: true });
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// ======================================================
// MIDDLEWARES
// ======================================================

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get("/admin.html", exigirAdmin, function (req, res) {

    res.sendFile(
        path.join(
            PUBLIC_DIR,
            "admin.html"
        )
    );
});

// Arquivos públicos
app.use(express.static(PUBLIC_DIR));

// ======================================================
// UPLOAD DE IMAGENS
// ======================================================

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, UPLOADS_DIR);
    },

    filename: function (req, file, cb) {
        const extensao = path.extname(file.originalname).toLowerCase();

        const nome =
            Date.now() +
            "-" +
            crypto.randomBytes(5).toString("hex") +
            extensao;

        cb(null, nome);
    }
});

const upload = multer({
    storage: storage,

    limits: {
        fileSize: 10 * 1024 * 1024
    },

    fileFilter: function (req, file, cb) {

        const tiposPermitidos = [
            "image/jpeg",
            "image/png",
            "image/webp",
            "image/gif"
        ];

        if (tiposPermitidos.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error("Formato de imagem não permitido."));
        }
    }
});

// ======================================================
// FUNÇÕES
// ======================================================

async function lerNoticias() {

    const { data, error } = await supabase
        .from("noticias")
        .select("*");

    if (error) {
        throw error;
    }

    return Array.isArray(data)
        ? data.map(normalizarNoticia)
        : [];
}


function normalizarNoticia(noticia) {

    return {
        id: noticia.id,
        titulo: noticia.titulo,
        categoria: noticia.categoria,
        conteudo: noticia.conteudo,
        imagem: noticia.imagem,
        status: noticia.status,
        criadoEm: noticia.criadoEm || noticia.criado_em,
        atualizadoEm: noticia.atualizadoEm || noticia.atualizado_em
    };
}


function obtenerCookie(req, nombre) {

    const cookies = String(req.headers.cookie || "")
        .split(";")
        .map(function (cookie) {
            return cookie.trim().split("=");
        });

    const cookie = cookies.find(function (partes) {
        return partes[0] === nombre;
    });

    return cookie
        ? decodeURIComponent(cookie.slice(1).join("="))
        : "";
}


function estaAutenticado(req) {

    const token = obtenerCookie(req, "92amz_admin_session");
    const sesion = sesionesAdmin.get(token);

    if (!sesion) {
        return false;
    }

    if (sesion.expiraEm <= Date.now()) {
        sesionesAdmin.delete(token);
        return false;
    }

    return true;
}


function exigirAdmin(req, res, next) {

    if (estaAutenticado(req)) {
        return next();
    }

    if (req.path === "/admin" || req.path === "/admin/") {
        return res.send(`
<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Login — 92AMZ</title>
</head>
<body>
    <main>
        <h1>92AMZ — Acesso administrativo</h1>
        <form method="POST" action="/admin/login">
            <label for="usuario">Usuário</label>
            <input id="usuario" name="usuario" required autofocus>
            <label for="senha">Senha</label>
            <input id="senha" name="senha" type="password" required>
            <button type="submit">Entrar</button>
        </form>
    </main>
</body>
</html>
        `);
    }

    return res.status(401).json({
        success: false,
        message: "Autenticação necessária."
    });
}


function criarId() {

    return (
        Date.now().toString(36) +
        "-" +
        crypto.randomBytes(6).toString("hex")
    );
}


function escaparHTML(texto) {

    return String(texto || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}
function prepararConteudoWordPress(conteudo, textoPlano) {
    if (!conteudo) return "";

    let html = String(conteudo);

    // Remover comentarios de bloques de WordPress
    html = html.replace(/<!--\s*\/?wp:[\s\S]*?-->/gi, "");

    // Remover otros comentarios HTML
    html = html.replace(/<!--[\s\S]*?-->/g, "");

    // Corregir URLs antiguas del sitio
    html = html.replace(
        /http:\/\/92amz\.com\.br\/wp-content\/uploads/gi,
        "https://92amz.com.br/wp-content/uploads"
    );

    // Corregir URLs relativas de imágenes
    html = html.replace(
        /src=["']\/wp-content\/uploads/gi,
        'src="https://92amz.com.br/wp-content/uploads'
    );

    if (textoPlano) {
        return html
            .replace(/<[^>]*>/g, " ")
            .replace(/&nbsp;|&#160;/gi, " ")
            .replace(/&quot;|&#34;/gi, '"')
            .replace(/&#039;|&#39;/gi, "'")
            .replace(/&lt;|&#60;/gi, "<")
            .replace(/&gt;|&#62;/gi, ">")
            .replace(/&amp;|&#38;/gi, "&")
            .replace(/\s+/g, " ")
            .trim();
    }

    return html.trim();
}
// ======================================================
// EXTRAIR IMAGEM DA NOTÍCIA IMPORTADA DO WORDPRESS
// ======================================================

function extrairImagemDoConteudo(conteudo) {
    if (!conteudo) return null;

    const texto = String(conteudo);

    // Procura uma tag <img> e pega o endereço da imagem
    const match = texto.match(
        /<img[^>]+src=["']([^"']+)["']/i
    );

    if (!match || !match[1]) {
        return null;
    }

    let url = match[1].trim();

    // Corrigir entidades HTML
    url = url
        .replace(/&amp;/g, "&")
        .replace(/&#038;/g, "&");

    // Se for URL relativa
    if (url.startsWith("/")) {
        return url;
    }

    // Só aceitar http/https
    if (
        url.startsWith("http://") ||
        url.startsWith("https://")
    ) {
        return url;
    }

    return null;
}


function formatarData(data) {

    if (!data) {
        return "";
    }

    const dataObj = new Date(data);

    if (isNaN(dataObj.getTime())) {
        return "";
    }

    return dataObj.toLocaleDateString(
        "pt-BR",
        {
            day: "2-digit",
            month: "2-digit",
            year: "numeric"
        }
    );
}

// ======================================================
// SITE PÚBLICO
// ======================================================

app.get("/", async function (req, res) {

    const noticias = await lerNoticias();

    const publicadas = noticias.filter(function (noticia) {
        return noticia.status !== "rascunho";
    });

    let destaque = "";
    let outrasNoticias = "";

    // ==================================================
    // NOTÍCIA DESTAQUE
    // ==================================================

    if (publicadas.length > 0) {

        const noticia = publicadas[0];

        destaque = `
            <article class="destaque">

                ${
                    noticia.imagem
                    ?
                    `<img
                        src="${escaparHTML(noticia.imagem)}"
                        alt="${escaparHTML(noticia.titulo)}"
                    >`
                    :
                    ""
                }

                <div class="destaque-conteudo">

                    <span class="categoria">
                        ${escaparHTML(noticia.categoria || "GERAL")}
                    </span>

                    <h2>
                        ${escaparHTML(noticia.titulo)}
                    </h2>

                    <p>
                        ${escaparHTML(
                            prepararConteudoWordPress(
                                noticia.conteudo,
                                true
                            ).substring(0, 300)
                        )}
                        ${
                            prepararConteudoWordPress(
                                noticia.conteudo,
                                true
                            ).length > 300
                            ? "..."
                            : ""
                        }
                    </p>

                    <small>
                        ${formatarData(noticia.criadoEm)}
                    </small>

                    <br>

                    <a
                        class="botao"
                        href="/noticia/${encodeURIComponent(noticia.id)}"
                    >
                        Ler notícia
                    </a>

                </div>

            </article>
        `;
    }

    // ==================================================
    // OUTRAS NOTÍCIAS
    // ==================================================

    if (publicadas.length > 1) {

        outrasNoticias = publicadas
            .slice(1)
            .map(function (noticia) {

                return `
                    <article class="card">

                        ${
                            noticia.imagem
                            ?
                            `<img
                                src="${escaparHTML(noticia.imagem)}"
                                alt="${escaparHTML(noticia.titulo)}"
                            >`
                            :
                            `<div class="sem-imagem">
                                92AMZ
                            </div>`
                        }

                        <div class="card-conteudo">

                            <span class="categoria">
                                ${escaparHTML(
                                    noticia.categoria || "GERAL"
                                )}
                            </span>

                            <h3>
                                ${escaparHTML(noticia.titulo)}
                            </h3>

                            <p>
                                ${escaparHTML(
                                    prepararConteudoWordPress(
                                        noticia.conteudo,
                                        true
                                    ).substring(0, 150)
                                )}
                                ${
                                    prepararConteudoWordPress(
                                        noticia.conteudo,
                                        true
                                    ).length > 150
                                    ? "..."
                                    : ""
                                }
                            </p>

                            <small>
                                ${formatarData(noticia.criadoEm)}
                            </small>

                            <br>

                            <a
                                class="link"
                                href="/noticia/${encodeURIComponent(noticia.id)}"
                            >
                                Ler mais →
                            </a>

                        </div>

                    </article>
                `;

            })
            .join("");
    }

    // ==================================================
    // HTML DO SITE
    // ==================================================

    res.send(`

<!DOCTYPE html>

<html lang="pt-BR">

<head>

<meta charset="UTF-8">

<meta
    name="viewport"
    content="width=device-width, initial-scale=1.0"
>

<title>
    92AMZ — Portal de Notícias
</title>

<meta
    name="description"
    content="92AMZ — Portal de notícias e informação."
>

<style>

* {
    box-sizing: border-box;
}

body {

    margin: 0;

    font-family:
        Arial,
        Helvetica,
        sans-serif;

    background: #f4f6f9;

    color: #172033;
}

/* HEADER */

header {

    background: #101827;

    color: white;
}

.header {

    max-width: 1200px;

    margin: auto;

    padding:
        18px 25px;

    display: flex;

    align-items: center;

    justify-content: space-between;
}

.logo {

    font-size: 30px;

    font-weight: 800;

    letter-spacing: 1px;
}

.menu a {

    color: white;

    text-decoration: none;

    margin-left: 25px;

    font-size: 15px;
}

.menu a:hover {

    color: #ef4444;
}

/* HERO */

.hero {

    background: white;

    border-bottom:
        1px solid #e5e7eb;
}

.hero-inner {

    max-width: 1200px;

    margin: auto;

    padding:
        45px 25px;
}

.hero h1 {

    margin: 0 0 10px;

    font-size: 40px;
}

.hero p {

    margin: 0;

    color: #667085;

    font-size: 17px;
}

/* MAIN */

main {

    max-width: 1200px;

    margin:
        35px auto;

    padding:
        0 25px;
}

.titulo-secao {

    font-size: 26px;

    margin-bottom: 20px;
}

/* DESTAQUE */

.destaque {

    background: white;

    border-radius: 16px;

    overflow: hidden;

    box-shadow:
        0 8px 30px rgba(16,24,39,.08);

    margin-bottom: 30px;
}

.destaque img {

    width: 100%;

    max-height: 450px;

    object-fit: cover;

    display: block;
}

.destaque-conteudo {

    padding: 30px;
}

.destaque h2 {

    font-size: 34px;

    line-height: 1.2;

    margin:
        12px 0;
}

.destaque p {

    color: #667085;

    line-height: 1.7;

    font-size: 17px;
}

/* CATEGORIA */

.categoria {

    display: inline-block;

    background: #fff0f0;

    color: #dc2626;

    padding:
        6px 10px;

    border-radius: 20px;

    font-size: 12px;

    font-weight: bold;
}

/* BOTÃO */

.botao {

    display: inline-block;

    margin-top: 15px;

    padding:
        11px 17px;

    background: #dc2626;

    color: white;

    text-decoration: none;

    border-radius: 8px;

    font-weight: bold;
}

.botao:hover {

    background: #b91c1c;
}

/* GRID */

.grid {

    display: grid;

    grid-template-columns:
        repeat(3, 1fr);

    gap: 22px;
}

/* CARD */

.card {

    background: white;

    border-radius: 14px;

    overflow: hidden;

    box-shadow:
        0 5px 22px rgba(16,24,39,.07);
}

.card img,
.sem-imagem {

    width: 100%;

    height: 190px;

    object-fit: cover;
}

.sem-imagem {

    display: flex;

    align-items: center;

    justify-content: center;

    background: #101827;

    color: white;

    font-size: 27px;

    font-weight: bold;
}

.card-conteudo {

    padding: 20px;
}

.card h3 {

    font-size: 20px;

    line-height: 1.3;

    margin:
        10px 0;
}

.card p {

    color: #667085;

    line-height: 1.6;
}

.link {

    display: inline-block;

    margin-top: 12px;

    color: #dc2626;

    text-decoration: none;

    font-weight: bold;
}

/* VAZIO */

.vazio {

    background: white;

    padding: 50px;

    border-radius: 15px;

    text-align: center;

    color: #667085;
}

/* FOOTER */

footer {

    margin-top: 70px;

    background: #101827;

    color: #cbd5e1;

    text-align: center;

    padding: 30px;
}

/* RESPONSIVO */

@media (max-width: 850px) {

    .grid {

        grid-template-columns: 1fr;
    }

    .destaque h2 {

        font-size: 27px;
    }

    .hero h1 {

        font-size: 32px;
    }

    .menu {

        display: none;
    }
}

</style>

</head>

<body>

<header>

    <div class="header">

        <div class="logo">
            92AMZ
        </div>

        <nav class="menu">

            <a href="/">
                Início
            </a>

        </nav>

    </div>

</header>


<section class="hero">

    <div class="hero-inner">

        <h1>
            92AMZ — Portal de Notícias
        </h1>

        <p>
            Informação, notícias e acontecimentos em destaque.
        </p>

    </div>

</section>


<main>

    <h2 class="titulo-secao">
        Últimas notícias
    </h2>

    ${
        publicadas.length === 0
        ?
        `
        <div class="vazio">

            Nenhuma notícia publicada ainda.

        </div>
        `
        :
        `
        ${destaque}

        ${
            outrasNoticias
            ?
            `<div class="grid">
                ${outrasNoticias}
            </div>`
            :
            ""
        }
        `
    }

</main>


<footer>

    © ${new Date().getFullYear()}
    92AMZ — Todos os direitos reservados.

</footer>


</body>

</html>

    `);
});

// ======================================================
// PÁGINA INDIVIDUAL DA NOTÍCIA
// ======================================================

app.get("/noticia/:id", async function (req, res) {

    const noticias = await lerNoticias();

    const noticia = noticias.find(function (item) {

        return item.id === req.params.id;

    });

    if (!noticia) {

        return res.status(404).send(`

<!DOCTYPE html>

<html lang="pt-BR">

<head>

<meta charset="UTF-8">

<title>Notícia não encontrada</title>

</head>

<body>

<h1>Notícia não encontrada</h1>

<a href="/">
    Voltar para o início
</a>

</body>

</html>

        `);
    }

    res.send(`

<!DOCTYPE html>

<html lang="pt-BR">

<head>

<meta charset="UTF-8">

<meta
    name="viewport"
    content="width=device-width, initial-scale=1.0"
>

<title>
    ${escaparHTML(noticia.titulo)}
    — 92AMZ
</title>

<style>

body {

    margin: 0;

    background: #f4f6f9;

    font-family:
        Arial,
        Helvetica,
        sans-serif;

    color: #172033;
}

header {

    background: #101827;

    color: white;

    padding: 20px;
}

.header {

    max-width: 900px;

    margin: auto;

    display: flex;

    justify-content: space-between;

    align-items: center;
}

.logo {

    font-size: 27px;

    font-weight: bold;
}

.voltar {

    color: white;

    text-decoration: none;
}

main {

    max-width: 900px;

    margin: 40px auto;

    padding:
        0 20px;
}

article {

    background: white;

    padding: 35px;

    border-radius: 16px;

    box-shadow:
        0 8px 30px rgba(0,0,0,.07);
}

.categoria {

    color: #dc2626;

    font-size: 13px;

    font-weight: bold;
}

h1 {

    font-size: 42px;

    line-height: 1.15;

    margin:
        12px 0;
}

.data {

    color: #98a2b3;

    margin-bottom: 25px;
}

article img {

    width: 100%;

    max-height: 550px;

    object-fit: cover;

    border-radius: 12px;

    margin-bottom: 25px;
}

.conteudo {

    font-size: 18px;

    line-height: 1.8;

    white-space: pre-wrap;
}

@media(max-width:700px) {

    h1 {

        font-size: 30px;
    }

    article {

        padding: 22px;
    }
}

</style>

</head>

<body>

<header>

<div class="header">

<div class="logo">
92AMZ
</div>

<a
    href="/"
    class="voltar"
>
← Voltar
</a>

</div>

</header>


<main>

<article>

<div class="categoria">

${escaparHTML(
    noticia.categoria || "GERAL"
)}
</div>


<h1>

${escaparHTML(
    noticia.titulo
)}

</h1>


<div class="data">

${formatarData(
    noticia.criadoEm
)}

</div>


${
    noticia.imagem
    ?
    `
    <img
        src="${escaparHTML(noticia.imagem)}"
        alt="${escaparHTML(noticia.titulo)}"
    >
    `
    :
    ""
}


<div class="conteudo">

${prepararConteudoWordPress(
    noticia.conteudo
)}

</div>

</div>

</article>

</main>

</body>

</html>

    `);
});

// ======================================================
// ADMIN
// ======================================================

app.post("/admin/login", function (req, res) {

    const usuario = String(req.body.usuario || "");
    const senha = String(req.body.senha || "");

    if (usuario !== ADMIN_USER || senha !== ADMIN_PASSWORD) {
        return res.status(401).send("Usuário ou senha inválidos.");
    }

    const token = crypto.randomBytes(32).toString("hex");

    sesionesAdmin.set(token, {
        expiraEm: Date.now() + 8 * 60 * 60 * 1000
    });

    res.setHeader(
        "Set-Cookie",
        "92amz_admin_session=" +
        encodeURIComponent(token) +
        "; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800" +
        (process.env.NODE_ENV === "production" ? "; Secure" : "")
    );

    res.redirect("/admin");
});


app.get("/admin", exigirAdmin, function (req, res) {

    res.sendFile(
        path.join(
            PUBLIC_DIR,
            "admin.html"
        )
    );
});


app.get("/admin/", exigirAdmin, function (req, res) {

    res.sendFile(
        path.join(
            PUBLIC_DIR,
            "admin.html"
        )
    );
});

// ======================================================
// API STATUS
// ======================================================

app.get("/api/status", function (req, res) {

    res.json({

        success: true,

        message:
            "92AMZ CMS funcionando corretamente",

        status:
            "online"

    });
});

// ======================================================
// API — LISTAR NOTÍCIAS
// ======================================================

app.get("/api/noticias", async function (req, res) {

    try {

        const noticias =
            await lerNoticias();

        res.json({

            success: true,

            noticias:
                noticias

        });

    } catch (erro) {

        console.error(
            "Erro ao listar notícias:",
            erro
        );

        res.status(500).json({

            success: false,

            message:
                "Erro ao carregar notícias."

        });
    }
});

// ======================================================
// API — PUBLICAR NOTÍCIA
// ======================================================

app.post(
    "/api/noticias",
    exigirAdmin,
    upload.single("imagem"),
    async function (req, res) {

        try {

            const titulo =
                String(
                    req.body.titulo || ""
                ).trim();

            const categoria =
                String(
                    req.body.categoria || "GERAL"
                ).trim();

            const conteudo =
                String(
                    req.body.conteudo || ""
                ).trim();

            if (!titulo) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Digite o título da notícia."

                });
            }

            if (!conteudo) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Digite o conteúdo da notícia."

                });
            }

            let imagem = null;

            if (req.file) {

                imagem =
                    "/uploads/" +
                    req.file.filename;
            }

            const agora =
                new Date().toISOString();

            const noticia = {

                id:
                    criarId(),

                titulo:
                    titulo,

                categoria:
                    categoria,

                conteudo:
                    conteudo,

                imagem:
                    imagem,

                status:
                    "publicada",

                criado_em:
                    agora,

                atualizado_em:
                    agora
            };

            const { data, error } = await supabase
                .from("noticias")
                .insert([noticia])
                .select()
                .single();

            if (error) {
                throw error;
            }

            console.log(
                "Nova notícia publicada:",
                noticia.titulo
            );

            res.status(201).json({

                success: true,

                message:
                    "Notícia publicada com sucesso.",

                noticia:
                    data ? normalizarNoticia(data) : noticia

            });

        } catch (erro) {

            console.error(
                "Erro ao publicar notícia:",
                erro
            );

            res.status(500).json({

                success: false,

                message:
                    "Erro interno ao publicar notícia."

            });
        }
    }
);

// ======================================================
// API — EXCLUIR NOTÍCIA
// ======================================================

app.delete(
    "/api/noticias/:id",
    exigirAdmin,
    async function (req, res) {

        try {

            const id =
                req.params.id;

            const { data: noticia, error: buscarError } = await supabase
                .from("noticias")
                .select("*")
                .eq("id", id)
                .maybeSingle();

            if (buscarError) {
                throw buscarError;
            }

            if (!noticia) {
                return res.status(404).json({
                    success: false,
                    message: "Notícia não encontrada."
                });
            }

            const { error: excluirError } = await supabase
                .from("noticias")
                .delete()
                .eq("id", id);

            if (excluirError) {
                throw excluirError;
            }

            if (noticia.imagem) {

                const caminhoImagem =
                    path.join(
                        PUBLIC_DIR,
                        noticia.imagem.replace(
                            /^\//,
                            ""
                        )
                    );

                if (
                    fs.existsSync(
                        caminhoImagem
                    )
                ) {

                    try {

                        fs.unlinkSync(
                            caminhoImagem
                        );

                    } catch (erroImagem) {

                        console.error(
                            "Erro ao apagar imagem:",
                            erroImagem
                        );

                    }
                }
            }

            res.json({

                success: true,

                message:
                    "Notícia excluída com sucesso."

            });

        } catch (erro) {

            console.error(
                "Erro ao excluir notícia:",
                erro
            );

            res.status(500).json({

                success: false,

                message:
                    "Erro ao excluir notícia."

            });
        }
    }
);

// ======================================================
// ERROS
// ======================================================

app.use(
    function (erro, req, res, next) {

        console.error(
            "Erro:",
            erro
        );

        if (
            erro instanceof multer.MulterError
        ) {

            return res.status(400).json({

                success: false,

                message:
                    "Erro no upload da imagem: " +
                    erro.message

            });
        }

        res.status(400).json({

            success: false,

            message:
                erro.message ||
                "Erro na solicitação."

        });
    }
);

// ======================================================
// ROTA NÃO ENCONTRADA
// ======================================================

app.use(
    function (req, res) {

        res.status(404).json({

            success: false,

            message:
                "Página não encontrada.",

            rota:
                req.originalUrl

        });
    }
);

// ======================================================
// SERVIDOR
// ======================================================
app.listen(
    PORT,
    HOST,
    function () {

        console.log("");

        console.log(
            "========================================"
        );

        console.log(
            "           92AMZ ONLINE"
        );

        console.log(
            "========================================"
        );

        console.log("");

        console.log(
            "SITE:"
        );

        console.log(
            `http://127.0.0.1:${PORT}/`
        );

        console.log("");

        console.log(
            "ADMIN:"
        );

        console.log(
            `http://127.0.0.1:${PORT}/admin`
        );

        console.log("");

        console.log(
            "API:"
        );

        console.log(
            `http://127.0.0.1:${PORT}/api/status`
        );

        console.log("");

        console.log(
            "========================================"
        );

    }
);