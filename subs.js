//mkvextract   mkvinfo      mkvmerge     mkvpropedit
// const { exec } = import("child_process");
import { exec } from 'child_process'
import { parse, stringify } from 'lossless-json'

import { promisify } from 'util';
import { resolve } from 'path';
import fs from 'fs';
const readdir = promisify(fs.readdir);
const stat = promisify(fs.stat);

var IS_TEST = process.argv[3] == 'test'
var TOTAL_FILES = 0
var TOTAL_SUBS = 0
var TOTAL_AUDIOS = 0

index()

function index() {
    let folder = process.argv[2]

    if (!folder) {
        console.log("Como usar el script")
        console.log("1. Pasar como parametro la carpeta o el archivo")
        console.log("   ej. node subs.js \"series/One Punch Man/Season 1\"")
        console.log("   ej. node subs.js \"series/One Punch Man/Season 1/1x01.mkv\"")
        console.log("El script debe estar en una carpeta superior a todas las series")
        console.log("Se marcaran todos los subtitulos como por defecto 0 excepto:")
        console.log("   Si tiene subtitulos en castillian se marca como 1");
        console.log("   Si no tiene castillian pero tiene spanish se marca como 1")
        console.log("   Si no tiene ningun subtitulo spa se marca el primero como 1")
        console.log("Soporta rutas absolutas")
        return
    }

    getFiles(folder)
        .then(files => {
            files.forEach(f => {
                setDefaultSubs(f)
            })
        })
        .catch(e => console.error(e));
}

/**
 * Devuelve las rutas absolutas de los archivos de la carpera dir, si se pasa un
 * archivo se devuelve la ruta absoluta de ese archivo
 * @param   {string}    dir Directorio o archivo a modificar
 * @returns {Array}     Array con las rutas absolutas de los archivos
 * @example
 * // returns /home/user/folder/file.mkv
 * getFiles("folder");
 * @example
 * // returns /home/user/folder/file.mkv
 * getFiles("folder/file.mkv");
 */
async function getFiles(dir) {
    if (dir.match(/\.mkv$/)) {
        // si es ruta absoluta no se le concatena nada
        if (dir.match(/^\//)) {
            return [dir.replaceAll(/(?<!\\)"/g, '\\"')]
        }
        // si tiene " en la ruta se escapan
        return [import.meta.dirname + '/' + dir.replaceAll(/(?<!\\)"/g, '\\"')]
    }

    const subdirs = await readdir(dir);
    const files = await Promise.all(subdirs.map(async (subdir) => {
        const res = resolve(dir, subdir);

        if ((await stat(res)).isDirectory()) {
            return getFiles(res)
        }

        if (!res.match(/\.mkv$/)) {
            return null
        }

        return res.replaceAll(/(?<!\\)"/g, '\\"')
    }));
    return files.filter(e => e).reduce((a, f) => a.concat(f), []);
}

/**
 * Escanea los subtitulos del mkv, marca todos a por defecto 0 excepto spanish
 * @param   {string}    file Comando a ejecutar si no se indica se usa el primero del queue
 * @returns {Boolean}   Resultado de la ejecucion
 */
function setDefaultSubs(file) {
    TOTAL_FILES++
    exec(`mkvmerge -J "${file}"`, {maxBuffer: undefined}, (error, stdout, stderr) => {
        if (error) {
            console.error(`error: ${error.message}`)
            return false
        }

        if (stderr) {
            console.error(`stderr: ${stderr}`)
            return false
        }

        let mkvData        = parse(stdout)
        if (!mkvData || !mkvData.tracks) {
            console.error("No se han podido leer los datos del mkv " + file)
            return false
        }

        // subtitulos
        let subtitleTracks = mkvData.tracks.filter(e => e.type == 'subtitles')
        let subtitleHasCastillian = getSpanishSub(subtitleTracks);
        let subtitleHasSpanish    = subtitleTracks.find(e => e.properties.language == 'spa')
        let subtitleHasEnglish    = subtitleTracks.find(e => e.properties.language == 'eng')

        // audios
        let audioTracks = mkvData.tracks.filter(e => e.type == 'audio')
        let audioHasJapanses  = audioTracks.find(e => e.properties.language == 'jpn')
        let audioHasEnglish   = audioTracks.find(e => e.properties.language_ietf == 'eng')
        let audioHasSpanish   = audioTracks.find(e => e.properties.language_ietf == 'spa')

        if (!subtitleTracks.length && audioTracks.length == 1 || (!subtitleTracks.length && !audioTracks.length)) {
            console.log("Skipped " + file)
            return false
        }

        let defaultSubTrack   = subtitleTracks[0].properties.uid.value;
        let defaultAudioTrack = audioTracks[0].properties.uid.value;
        let commands          = []
        TOTAL_SUBS            += subtitleTracks.length
        TOTAL_AUDIOS          += audioTracks.length

        if (IS_TEST) {
            console.log("Archivos: " + TOTAL_FILES + " Subtitulos: " + TOTAL_SUBS + " Audios: " + TOTAL_AUDIOS)
        }

        //cambiar el ordern de los if para cambiar las preferencias de los idiomas (el ultimo que se cumpla es el que se marca como default)

        // tercera preferencia de subtitulo
        if (subtitleHasEnglish) {
            defaultSubTrack = subtitleHasEnglish.properties.uid.value
        }

        // segunda preferencia de subtitulo
        if (subtitleHasSpanish) {
            defaultSubTrack = subtitleHasSpanish.properties.uid.value
        }

        // Subtitulo preferido
        if (subtitleHasCastillian) {
            defaultSubTrack = subtitleHasCastillian.properties.uid.value
        }

        // tercera preferencia de audio
        if (audioHasSpanish) {
            defaultAudioTrack = audioHasSpanish.properties.uid.value
        }

        // segunda preferencia de audio
        if (audioHasEnglish) {
            defaultAudioTrack = audioHasEnglish.properties.uid.value
        }

        // Audio preferido
        if (audioHasJapanses) {
            defaultAudioTrack = audioHasJapanses.properties.uid.value
        }

        if (IS_TEST) {
            console.log('#########Subtitulos#########')
        }
        subtitleTracks.forEach(e => {
            let defaultVal = (defaultSubTrack == e.properties.uid.value ? 1 : 0)
            if (IS_TEST) {
                console.log(`mkvpropedit "${file}" -e track:=${e.properties.uid.value} --set flag-default=${defaultVal}`)
                console.log(`(${e.properties.track_name ? e.properties.track_name  : e.properties.language})`)
            }
            commands.push(`mkvpropedit "${file}" -e track:=${e.properties.uid.value} --set flag-default=${defaultVal}`)
        })

        if (IS_TEST) {
            console.log('#########Audios#########')
        }
        audioTracks.forEach(e => {
            let defaultVal = (defaultAudioTrack == e.properties.uid.value ? 1 : 0)
            if (IS_TEST) {
                console.log(`mkvpropedit "${file}" -e track:=${e.properties.uid.value} --set flag-default=${defaultVal}`)
                console.log(`(${e.properties.track_name ? e.properties.track_name  : e.properties.language})`)
            }
            commands.push(`mkvpropedit "${file}" -e track:=${e.properties.uid.value} --set flag-default=${defaultVal}`)
        })

        if (!IS_TEST) {
            run(null, commands, file.replace(import.meta.dirname + '/', ''))
        }
    });
}

function getSpanishSub(subtitles) {
  let esMatch = new RegExp(createDiacriticInsensitiveWord("es"), 'i');
  let onlyEs = subtitles.filter(e => e.properties.language == 'spa' || (e.properties.language == 'und' && e.properties.track_name && e.properties.track_name.match(esMatch)));
  onlyEs = onlyEs.map(e => e.properties);
  let latMatch       = new RegExp(createDiacriticInsensitiveWord("lat"), 'i');
  let laMatch        = new RegExp("^" + createDiacriticInsensitiveWord("la") + "$", 'i');
  let venezuelaMatch = new RegExp(createDiacriticInsensitiveWord("venezuela"), 'i');
  let karaokeMatch   = new RegExp(createDiacriticInsensitiveWord("karaoke"), 'i');
  let forzadoMatch   = new RegExp(createDiacriticInsensitiveWord("forzado"), 'i');
  let forcedMatch    = new RegExp(createDiacriticInsensitiveWord("forced"), 'i');
  let cartelesMatch  = new RegExp(createDiacriticInsensitiveWord("carteles"), 'i');
  let signsMatch     = new RegExp(createDiacriticInsensitiveWord("signs"), 'i');
  let songsMatch     = new RegExp(createDiacriticInsensitiveWord("songs"), 'i');
  let portuguesMatch = new RegExp(createDiacriticInsensitiveWord("portugues"), 'i');

  let castellanoMatch  = new RegExp(createDiacriticInsensitiveWord("castellano") + '|' + createDiacriticInsensitiveWord("europe") + '|' + createDiacriticInsensitiveWord("castilian") + '|' + createDiacriticInsensitiveWord("españa") + '|' + createDiacriticInsensitiveWord("spanish\\[esp\\]") + '|' + createDiacriticInsensitiveWord("spanish \\[esp\\]") + '|' + createDiacriticInsensitiveWord("selecta") + '|' + createDiacriticInsensitiveWord("Spanish \\(Spain\\)") + '|' + createDiacriticInsensitiveWord("Spanish Spain"), 'i');

  onlyEs = onlyEs.filter(e => e.language_ietf !== "es-419");
  onlyEs = onlyEs.filter(e => !e.track_name || !e.track_name.match(latMatch));
  onlyEs = onlyEs.filter(e => !e.track_name || !e.track_name.match(laMatch));
  onlyEs = onlyEs.filter(e => !e.track_name || !e.track_name.match(venezuelaMatch));
  onlyEs = onlyEs.filter(e => !e.track_name || !e.track_name.match(karaokeMatch));
  onlyEs = onlyEs.filter(e => !e.track_name || !e.track_name.match(forzadoMatch));
  onlyEs = onlyEs.filter(e => !e.track_name || !e.track_name.match(forcedMatch));
  onlyEs = onlyEs.filter(e => !e.track_name || !e.track_name.match(cartelesMatch));
  onlyEs = onlyEs.filter(e => !e.track_name || !e.track_name.match(signsMatch));
  onlyEs = onlyEs.filter(e => !e.track_name || !e.track_name.match(songsMatch));
  onlyEs = onlyEs.filter(e => !e.track_name || !e.track_name.match(portuguesMatch));

  let castillianSub = onlyEs.filter(e => e.track_name && e.track_name.match(castellanoMatch));
  if (castillianSub.length > 0) {
    castillianSub = castillianSub[0]
  } else {
    // si no hay un claro subtitulo castellano, nos quedamos con el primero que sea español o indeterminado
    castillianSub = onlyEs[0]
  }

  return {"properties": castillianSub}
}

function createDiacriticInsensitiveWord(word) {
    let mappings = {
        'a': String.fromCharCode(65, 97, 192, 224, 193, 225, 194, 226, 195, 227, 196, 228, 229, 258, 259),
        'e': String.fromCharCode(69, 101, 200, 232, 201, 233, 202, 234, 203, 235),
        'i': String.fromCharCode(73, 105, 204, 236, 205, 237, 206, 238, 207, 239),
        'o': String.fromCharCode(79, 111, 210, 242, 211, 243, 212, 244, 213, 245, 214, 246),
        'n': String.fromCharCode(78, 110, 209, 241),
        'u': String.fromCharCode(85, 117, 217, 249, 218, 250, 219, 251, 220, 252),
        'c': String.fromCharCode(67, 99, 199, 231),
        'y': String.fromCharCode(89, 121, 221, 253, 159, 255),
    };

    let a = new RegExp('['+mappings.a+']','gi')
    let e = new RegExp('['+mappings.e+']','gi')
    let i = new RegExp('['+mappings.i+']','gi')
    let o = new RegExp('['+mappings.o+']','gi')
    let n = new RegExp('['+mappings.n+']','gi')
    let u = new RegExp('['+mappings.u+']','gi')
    let c = new RegExp('['+mappings.c+']','gi')
    let y = new RegExp('['+mappings.y+']','gi')

    return word.replace(a, '['+mappings.a+']')
               .replace(e, '['+mappings.e+']')
               .replace(i, '['+mappings.i+']')
               .replace(o, '['+mappings.o+']')
               .replace(n, '['+mappings.n+']')
               .replace(u, '['+mappings.u+']')
               .replace(c, '['+mappings.c+']')
               .replace(y, '['+mappings.y+']')
}

/**
 * Ejecuta una lista de comandos de forma ordenada y sincrona
 * @param   {string}    command     Comando a ejecutar si no se indica se usa el primero del queue
 * @param   {Array}     queue       Array con los comandos a ejecutar
 * @param   {string}    fileCounter Archivo al que se le va a ejecutar el comando
 * @returns {Boolean}   Resultado de la ejecucion
 */
function run(command, queue = [], file = null) {
    if (!command) {
        if (!queue.length) {
            console.error("no hay comandos a ejecutar")
            return false
        }
        command = queue.shift()
    }

    exec(command, {maxBuffer: undefined}, (error, stdout, stderr) => {
        if (error) {
            console.error(`error: ${error.message}`)
            return false
        }
        if (stderr) {
            console.error(`stderr: ${stderr}`)
            return false
        }

        console.log("commands left: " + queue.length + (file ? ' del archivo ' + file : ''))

        if (queue.length) {
            run(queue.shift(), queue, file)
        }
    })
    return true
}
