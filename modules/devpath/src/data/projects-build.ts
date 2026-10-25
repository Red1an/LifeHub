import { parseProject, parseStage, type Project, type Stage } from "../lib/workshop-parse.ts";
import exchange from "../../projects/exchange/project.md";
import exchange01 from "../../projects/exchange/stages/01/stage.md";
import exchange02 from "../../projects/exchange/stages/02/stage.md";
import exchange03 from "../../projects/exchange/stages/03/stage.md";
import exchange04 from "../../projects/exchange/stages/04/stage.md";
import exchange05 from "../../projects/exchange/stages/05/stage.md";
import exchange06 from "../../projects/exchange/stages/06/stage.md";

/*
 * Большие проекты, на которых строится обучение. Этап готов, когда у него есть stage.md (и тесты, и эталон);
 * остальные этапы из дорожной карты project.md показываются как «впереди».
 * Новый этап: папка projects/<id>/stages/NN + строка здесь + `node server/devpath/verify.ts <id>` из корня хаба (нужен Docker).
 */

export interface BuildProject extends Project {
  stages: Stage[];
}

export const BUILD_PROJECTS: BuildProject[] = [
  { ...parseProject("exchange", exchange), stages: [parseStage(1, exchange01), parseStage(2, exchange02), parseStage(3, exchange03), parseStage(4, exchange04), parseStage(5, exchange05), parseStage(6, exchange06)] },
];

export const buildProjectById = (id: string) => BUILD_PROJECTS.find((p) => p.id === id);
