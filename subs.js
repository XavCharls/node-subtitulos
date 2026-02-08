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
        let subtitleTracks = mkvData.tracks.filter(e => e.type == 'subtitles')
        let subtitleHasCastillian  = subtitleTracks.find(e => e.properties.language_ietf == 'es-ES')
        let subtitleHasSpanish     = subtitleTracks.find(e => e.properties.language == 'spa')

        let audioTracks = mkvData.tracks.filter(e => e.type == 'audio')
        let audioHasJapanses  = audioTracks.find(e => e.properties.language == 'jpn')
        let audioHasEnglish  = audioTracks.find(e => e.properties.language_ietf == 'eng')
        let audioHasSpanish  = audioTracks.find(e => e.properties.language_ietf == 'spa')

        
        if (!subtitleTracks.length && audioTracks.length == 1) {
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

        if (subtitleHasSpanish) {
            defaultSubTrack = subtitleHasSpanish.properties.uid.value
        }

        if (subtitleHasCastillian) {
            defaultSubTrack = subtitleHasCastillian.properties.uid.value
        }

        if (audioHasSpanish) {
            defaultAudioTrack = audioHasSpanish.properties.uid.value
        }

        if (audioHasEnglish) {
            defaultAudioTrack = audioHasEnglish.properties.uid.value
        }

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
