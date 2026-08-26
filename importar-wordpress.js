const fs = require("fs");
const path = require("path");
const http = require("http");
const xml2js = require("xml2js");

// ======================================================
// CONFIGURAÇÃO
// ======================================================

const XML_FILE = path.join(
  __dirname,
  "92amzcombr.WordPress.2026-08-23.xml sitio de notisias.xml"
);

const API_HOST = "127.0.0.1";
const API_PORT = 4000;
const API_PATH = "/api/noticias";

// ======================================================
// LIMPAR TEXTO
// ======================================================

function limpiarTexto(texto) {
  if (texto === undefined || texto === null) {
    return "";
  }

  return String(texto)
    .replace(/<!\[CDATA\[/g, "")
    .replace(/\]\]>/g, "")
    .trim();
}

// ======================================================
// OBTENER VALOR DEL XML
// ======================================================

function obtenerValor(obj, nombre) {
  if (!obj || obj[nombre] === undefined) {
    return "";
  }

  const valor = obj[nombre];

  if (Array.isArray(valor)) {
    if (valor.length === 0) {
      return "";
    }

    if (typeof valor[0] === "object") {
      return "";
    }

    return limpiarTexto(valor[0]);
  }

  return limpiarTexto(valor);
}

// ======================================================
// OBTENER CATEGORIA
// ======================================================

function obtenerCategoria(item) {
  if (!item.category) {
    return "BRASIL";
  }

  const categorias = item.category;

  for (const categoria of categorias) {
    if (typeof categoria === "string") {
      const texto = limpiarTexto(categoria);

      if (texto) {
        return texto;
      }
    }

    if (categoria && categoria._) {
      const texto = limpiarTexto(categoria._);

      if (texto) {
        return texto;
      }
    }
  }

  return "BRASIL";
}

// ======================================================
// ENVIAR NOTICIA AL CMS
// ======================================================

function enviarNoticia(noticia) {
  return new Promise((resolve) => {
    const datos = JSON.stringify(noticia);

    const opciones = {
      hostname: API_HOST,
      port: API_PORT,
      path: API_PATH,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(datos)
      },
      timeout: 15000
    };

    const req = http.request(opciones, (res) => {
      let cuerpo = "";

      res.setEncoding("utf8");

      res.on("data", (parte) => {
        cuerpo += parte;
      });

      res.on("end", () => {
        const codigo = res.statusCode || 0;

        if (codigo >= 200 && codigo < 300) {
          resolve({
            sucesso: true,
            status: codigo,
            resposta: cuerpo
          });
        } else {
          resolve({
            sucesso: false,
            status: codigo,
            resposta: cuerpo
          });
        }
      });
    });

    req.on("timeout", () => {
      req.destroy();

      resolve({
        sucesso: false,
        status: 0,
        resposta: "Tempo limite de conexão."
      });
    });

    req.on("error", (erro) => {
      resolve({
        sucesso: false,
        status: 0,
        resposta: erro.message
      });
    });

    req.write(datos);
    req.end();
  });
}

// ======================================================
// ESPERAR
// ======================================================

function esperar(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

// ======================================================
// INICIAR IMPORTAÇÃO
// ======================================================

async function iniciar() {
  console.log("");
  console.log("==========================================");
  console.log("       IMPORTADOR WORDPRESS - 92AMZ");
  console.log("==========================================");
  console.log("");

  // ----------------------------------------------------
  // VERIFICAR XML
  // ----------------------------------------------------

  if (!fs.existsSync(XML_FILE)) {
    console.error("ERRO: arquivo XML não encontrado.");
    console.error("");
    console.error("Arquivo procurado:");
    console.error(XML_FILE);
    console.error("");

    process.exit(1);
  }

  console.log("Arquivo XML encontrado.");
  console.log("");

  // ----------------------------------------------------
  // LER XML
  // ----------------------------------------------------

  let contenido;

  try {
    contenido = fs.readFileSync(XML_FILE, "utf8");
  } catch (erro) {
    console.error("ERRO ao abrir o XML:");
    console.error(erro.message);
    process.exit(1);
  }

  console.log("Lendo XML...");

  // ----------------------------------------------------
  // REMOVER AVISOS ANTES DO XML
  // ----------------------------------------------------

  const posicionXML = contenido.indexOf("<?xml");

  if (posicionXML === -1) {
    console.error("");
    console.error("ERRO: declaração XML não encontrada.");
    process.exit(1);
  }

  contenido = contenido.substring(posicionXML);

  console.log("XML preparado.");
  console.log("");

  // ----------------------------------------------------
  // PARSEAR XML
  // ----------------------------------------------------

  let resultado;

  try {
    resultado = await xml2js.parseStringPromise(contenido, {
      explicitArray: true,
      trim: true
    });
  } catch (erro) {
    console.error("");
    console.error("ERRO AO LER XML:");
    console.error(erro.message);
    console.error("");
    process.exit(1);
  }

  // ----------------------------------------------------
  // OBTENER CANAL
  // ----------------------------------------------------

  const canal = resultado?.rss?.channel?.[0];

  if (!canal) {
    console.error("");
    console.error("ERRO: estrutura RSS/WordPress não encontrada.");
    process.exit(1);
  }

  const items = canal.item || [];

  console.log(`Itens encontrados no WordPress: ${items.length}`);
  console.log("");

  // ----------------------------------------------------
  // CONTADORES
  // ----------------------------------------------------

  let encontrados = 0;
  let importados = 0;
  let ignorados = 0;
  let erros = 0;

  // ----------------------------------------------------
  // IMPORTAR PUBLICAÇÕES
  // ----------------------------------------------------

  for (const item of items) {
    const tipo = obtenerValor(item, "wp:post_type");
    const status = obtenerValor(item, "wp:status");

    // Somente posts
    if (tipo !== "post") {
      ignorados++;
      continue;
    }

    // Somente publicados
    if (status && status !== "publish") {
      ignorados++;
      continue;
    }

    const titulo = obtenerValor(item, "title");
    const conteudo = obtenerValor(item, "content:encoded");
    const categoria = obtenerCategoria(item);
    const data = obtenerValor(item, "wp:post_date");

    // Verificar conteúdo
    if (!titulo || !conteudo) {
      ignorados++;
      continue;
    }

    encontrados++;

    const noticia = {
      titulo: titulo,
      categoria: categoria.toUpperCase(),
      conteudo: conteudo,
      data: data
    };

    console.log("------------------------------------------");
    console.log(`Importando: ${titulo}`);
    console.log(`Categoria: ${categoria}`);

    const resultadoEnvio = await enviarNoticia(noticia);

    if (resultadoEnvio.sucesso) {
      console.log("OK - notícia importada.");
      importados++;
    } else {
      console.log("ERRO ao enviar notícia.");
      console.log(`HTTP: ${resultadoEnvio.status}`);
      console.log(resultadoEnvio.resposta);
      erros++;
    }

    // Pequena pausa para não sobrecarregar o CMS
    await esperar(20);
  }

  // ----------------------------------------------------
  // RESULTADO FINAL
  // ----------------------------------------------------

  console.log("");
  console.log("==========================================");
  console.log("          IMPORTAÇÃO FINALIZADA");
  console.log("==========================================");
  console.log("");

  console.log(`Publicações encontradas: ${encontrados}`);
  console.log(`Importadas:              ${importados}`);
  console.log(`Ignoradas:               ${ignorados}`);
  console.log(`Erros:                   ${erros}`);

  console.log("");
  console.log("Importação concluída.");
  console.log("");
}

// ======================================================
// EXECUTAR
// ======================================================

iniciar().catch((erro) => {
  console.error("");
  console.error("ERRO FATAL:");
  console.error(erro);
  console.error("");
  process.exit(1);
});