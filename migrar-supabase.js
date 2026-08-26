require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error("Faltan SUPABASE_URL o SUPABASE_SECRET_KEY.");
    process.exit(1);
}

const supabase = createClient(
    SUPABASE_URL,
    SUPABASE_KEY
);

const archivo = path.join(
    __dirname,
    "data",
    "noticias.json"
);

async function migrar() {
    console.log("====================================");
    console.log("   MIGRACIÓN 92AMZ → SUPABASE");
    console.log("====================================");

    if (!fs.existsSync(archivo)) {
        console.error("No existe data/noticias.json");
        process.exit(1);
    }

    const noticias = JSON.parse(
        fs.readFileSync(archivo, "utf8")
    );

    console.log(`Noticias encontradas: ${noticias.length}`);
    console.log("");

    let exitos = 0;
    let errores = 0;

    for (const noticia of noticias) {

        const registro = {
            id: noticia.id,
            titulo: noticia.titulo,
            categoria: noticia.categoria || "GERAL",
            conteudo: noticia.conteudo || "",
            imagem: noticia.imagem || null,
            status: noticia.status || "publicada",
            criadoEm: noticia.criadoEm || new Date().toISOString(),
            atualizadoEm: noticia.atualizadoEm || new Date().toISOString()
        };

        const { error } = await supabase
            .from("noticias")
            .upsert(registro, {
                onConflict: "id"
            });

        if (error) {
            errores++;
            console.log(
                `ERRO: ${noticia.titulo}`
            );
            console.log(error.message);
        } else {
            exitos++;

            if (
                exitos % 100 === 0 ||
                exitos === noticias.length
            ) {
                console.log(
                    `Progresso: ${exitos}/${noticias.length}`
                );
            }
        }
    }

    console.log("");
    console.log("====================================");
    console.log("        MIGRAÇÃO FINALIZADA");
    console.log("====================================");
    console.log(`Importadas: ${exitos}`);
    console.log(`Erros:      ${errores}`);
}

migrar();