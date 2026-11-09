"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeIdCard = normalizeIdCard;
exports.hashIdCard = hashIdCard;
const crypto_1 = __importDefault(require("crypto"));
function normalizeIdCard(idCard) {
    return idCard.trim().replace(/x$/i, 'X');
}
function hashIdCard(idCard) {
    return crypto_1.default.createHash('sha256').update(normalizeIdCard(idCard)).digest('hex');
}
