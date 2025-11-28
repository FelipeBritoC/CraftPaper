import { db } from "../config/config.js";

// LISTAR MOVIMENTAÇÕES
export async function listarMovimentacoes(req, res) {
    try {
        const { tipo, produto_id, data_inicio, data_fim, pagina = 1, limite = 20 } = req.query;
        const offset = (pagina - 1) * limite;

        let query = `
            SELECT 
                m.*,
                p.nome as produto_nome,
                p.sku as produto_sku,
                c.nome as cliente_nome
            FROM movimentacoes m
            LEFT JOIN produtos p ON m.produto_id = p.id
            LEFT JOIN clientes c ON m.cliente_id = c.id
            WHERE 1=1
        `;
        const params = [];

        // Filtros
        if (tipo) {
            query += " AND m.tipo_movimentacao = ?";
            params.push(tipo);
        }

        if (produto_id) {
            query += " AND m.produto_id = ?";
            params.push(produto_id);
        }

        if (data_inicio) {
            query += " AND DATE(m.data_movimentacao) >= ?";
            params.push(data_inicio);
        }

        if (data_fim) {
            query += " AND DATE(m.data_movimentacao) <= ?";
            params.push(data_fim);
        }

        query += " ORDER BY m.data_movimentacao DESC LIMIT ? OFFSET ?";
        params.push(parseInt(limite), offset);

        const [movimentacoes] = await db.execute(query, params);

        // Contar total para paginação
        const [total] = await db.execute(
            "SELECT COUNT(*) as total FROM movimentacoes"
        );

        res.json({
            movimentacoes,
            paginacao: {
                pagina: parseInt(pagina),
                limite: parseInt(limite),
                total: total[0].total
            }
        });

    } catch (err) {
        console.error("Erro ao listar movimentações:", err);
        res.status(500).json({ erro: "Erro interno do servidor" });
    }
}

// CONSULTAR MOVIMENTAÇÃO POR ID
export async function consultarMovimentacao(req, res) {
    try {
        const { id } = req.params;

        const [movimentacoes] = await db.execute(`
            SELECT 
                m.*,
                p.nome as produto_nome,
                p.sku as produto_sku,
                c.nome as cliente_nome,
                c.email as cliente_email
            FROM movimentacoes m
            LEFT JOIN produtos p ON m.produto_id = p.id
            LEFT JOIN clientes c ON m.cliente_id = c.id
            WHERE m.id = ?
        `, [id]);

        if (movimentacoes.length === 0) {
            return res.status(404).json({ erro: "Movimentação não encontrada" });
        }

        res.json(movimentacoes[0]);

    } catch (err) {
        console.error("Erro ao consultar movimentação:", err);
        res.status(500).json({ erro: "Erro interno do servidor" });
    }
}

// CRIAR MOVIMENTAÇÃO (VENDA/ENTRADA)
export async function criarMovimentacao(req, res) {
    const connection = await db.getConnection();
    
    try {
        await connection.beginTransaction();

        const { 
            produto_id, 
            cliente_id, 
            quantidade, 
            tipo_movimentacao, // 'ENTRADA' ou 'SAIDA'
            preco_unitario,
            observacoes 
        } = req.body;

        // Validações básicas
        if (!produto_id || !quantidade || !tipo_movimentacao) {
            await connection.rollback();
            return res.status(400).json({ erro: "Produto, quantidade e tipo são obrigatórios" });
        }

        if (!['ENTRADA', 'SAIDA'].includes(tipo_movimentacao)) {
            await connection.rollback();
            return res.status(400).json({ erro: "Tipo deve ser ENTRADA ou SAIDA" });
        }

        if (quantidade <= 0) {
            await connection.rollback();
            return res.status(400).json({ erro: "Quantidade deve ser maior que zero" });
        }

        // Verificar se produto existe
        const [produto] = await connection.execute(
            "SELECT id, nome, estoque FROM produtos WHERE id = ?",
            [produto_id]
        );

        if (produto.length === 0) {
            await connection.rollback();
            return res.status(404).json({ erro: "Produto não encontrado" });
        }

        // Verificar se cliente existe (se fornecido)
        if (cliente_id) {
            const [cliente] = await connection.execute(
                "SELECT id FROM clientes WHERE id = ?",
                [cliente_id]
            );

            if (cliente.length === 0) {
                await connection.rollback();
                return res.status(404).json({ erro: "Cliente não encontrado" });
            }
        }

        // Verificar estoque para saída
        if (tipo_movimentacao === 'SAIDA') {
            const estoqueAtual = produto[0].estoque;
            if (estoqueAtual < quantidade) {
                await connection.rollback();
                return res.status(400).json({ 
                    erro: "Estoque insuficiente", 
                    estoque_atual: estoqueAtual,
                    quantidade_solicitada: quantidade 
                });
            }
        }

        // Calcular valor total
        const valorTotal = preco_unitario ? quantidade * preco_unitario : null;

        // Inserir movimentação
        const [result] = await connection.execute(
            `INSERT INTO movimentacoes 
                (produto_id, cliente_id, quantidade, tipo_movimentacao, preco_unitario, valor_total, observacoes) 
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
                produto_id,
                cliente_id || null,
                quantidade,
                tipo_movimentacao,
                preco_unitario || null,
                valorTotal,
                observacoes?.trim() || null
            ]
        );

        // Atualizar estoque do produto
        const operacao = tipo_movimentacao === 'ENTRADA' ? '+' : '-';
        await connection.execute(
            `UPDATE produtos SET estoque = estoque ${operacao} ? WHERE id = ?`,
            [quantidade, produto_id]
        );

        await connection.commit();

        res.status(201).json({ 
            mensagem: "Movimentação registrada com sucesso",
            id: result.insertId,
            tipo: tipo_movimentacao,
            produto: produto[0].nome
        });

    } catch (err) {
        await connection.rollback();
        console.error('Erro ao criar movimentação:', err);
        
        if (err.code === 'ER_NO_REFERENCED_ROW') {
            return res.status(400).json({ erro: "Produto ou cliente inválido" });
        }

        res.status(500).json({ erro: "Erro interno do servidor" });
    } finally {
        connection.release();
    }
}

// MOVIMENTAÇÃO DE ENTRADA (COMPRA/REPOSIÇÃO)
export async function entradaEstoque(req, res) {
    const connection = await db.getConnection();
    
    try {
        await connection.beginTransaction();

        const { produto_id, quantidade, preco_unitario, observacoes } = req.body;

        // Validações
        if (!produto_id || !quantidade) {
            await connection.rollback();
            return res.status(400).json({ erro: "Produto e quantidade são obrigatórios" });
        }

        if (quantidade <= 0) {
            await connection.rollback();
            return res.status(400).json({ erro: "Quantidade deve ser maior que zero" });
        }

        // Verificar se produto existe
        const [produto] = await connection.execute(
            "SELECT id, nome FROM produtos WHERE id = ?",
            [produto_id]
        );

        if (produto.length === 0) {
            await connection.rollback();
            return res.status(404).json({ erro: "Produto não encontrado" });
        }

        // Inserir movimentação de entrada
        const [result] = await connection.execute(
            `INSERT INTO movimentacoes 
                (produto_id, quantidade, tipo_movimentacao, preco_unitario, observacoes) 
             VALUES (?, ?, 'ENTRADA', ?, ?)`,
            [produto_id, quantidade, preco_unitario || null, observacoes?.trim() || null]
        );

        // Atualizar estoque
        await connection.execute(
            "UPDATE produtos SET estoque = estoque + ? WHERE id = ?",
            [quantidade, produto_id]
        );

        await connection.commit();

        res.status(201).json({ 
            mensagem: "Entrada de estoque registrada com sucesso",
            id: result.insertId,
            produto: produto[0].nome,
            quantidade
        });

    } catch (err) {
        await connection.rollback();
        console.error('Erro ao registrar entrada:', err);
        res.status(500).json({ erro: "Erro interno do servidor" });
    } finally {
        connection.release();
    }
}

// MOVIMENTAÇÃO DE SAÍDA (VENDA)
export async function saidaEstoque(req, res) {
    const connection = await db.getConnection();
    
    try {
        await connection.beginTransaction();

        const { produto_id, cliente_id, quantidade, preco_unitario, observacoes } = req.body;

        // Validações
        if (!produto_id || !quantidade || !cliente_id) {
            await connection.rollback();
            return res.status(400).json({ erro: "Produto, cliente e quantidade são obrigatórios" });
        }

        if (quantidade <= 0) {
            await connection.rollback();
            return res.status(400).json({ erro: "Quantidade deve ser maior que zero" });
        }

        // Verificar se produto existe e tem estoque
        const [produto] = await connection.execute(
            "SELECT id, nome, estoque FROM produtos WHERE id = ?",
            [produto_id]
        );

        if (produto.length === 0) {
            await connection.rollback();
            return res.status(404).json({ erro: "Produto não encontrado" });
        }

        if (produto[0].estoque < quantidade) {
            await connection.rollback();
            return res.status(400).json({ 
                erro: "Estoque insuficiente", 
                estoque_atual: produto[0].estoque 
            });
        }

        // Verificar se cliente existe
        const [cliente] = await connection.execute(
            "SELECT id, nome FROM clientes WHERE id = ?",
            [cliente_id]
        );

        if (cliente.length === 0) {
            await connection.rollback();
            return res.status(404).json({ erro: "Cliente não encontrado" });
        }

        // Calcular valor total
        const valorTotal = preco_unitario ? quantidade * preco_unitario : null;

        // Inserir movimentação de saída
        const [result] = await connection.execute(
            `INSERT INTO movimentacoes 
                (produto_id, cliente_id, quantidade, tipo_movimentacao, preco_unitario, valor_total, observacoes) 
             VALUES (?, ?, ?, 'SAIDA', ?, ?, ?)`,
            [produto_id, cliente_id, quantidade, preco_unitario || null, valorTotal, observacoes?.trim() || null]
        );

        // Atualizar estoque
        await connection.execute(
            "UPDATE produtos SET estoque = estoque - ? WHERE id = ?",
            [quantidade, produto_id]
        );

        await connection.commit();

        res.status(201).json({ 
            mensagem: "Venda registrada com sucesso",
            id: result.insertId,
            produto: produto[0].nome,
            cliente: cliente[0].nome,
            quantidade,
            valor_total: valorTotal
        });

    } catch (err) {
        await connection.rollback();
        console.error('Erro ao registrar venda:', err);
        res.status(500).json({ erro: "Erro interno do servidor" });
    } finally {
        connection.release();
    }
}

// RELATÓRIO DE MOVIMENTAÇÕES POR PRODUTO
export async function relatorioProduto(req, res) {
    try {
        const { produto_id, data_inicio, data_fim } = req.query;

        if (!produto_id) {
            return res.status(400).json({ erro: "ID do produto é obrigatório" });
        }

        let query = `
            SELECT 
                tipo_movimentacao,
                COUNT(*) as total_movimentacoes,
                SUM(quantidade) as quantidade_total,
                AVG(preco_unitario) as preco_medio,
                SUM(valor_total) as valor_total
            FROM movimentacoes 
            WHERE produto_id = ?
        `;
        const params = [produto_id];

        if (data_inicio) {
            query += " AND DATE(data_movimentacao) >= ?";
            params.push(data_inicio);
        }

        if (data_fim) {
            query += " AND DATE(data_movimentacao) <= ?";
            params.push(data_fim);
        }

        query += " GROUP BY tipo_movimentacao";

        const [relatorio] = await db.execute(query, params);

        // Buscar informações do produto
        const [produto] = await db.execute(
            "SELECT nome, estoque FROM produtos WHERE id = ?",
            [produto_id]
        );

        res.json({
            produto: produto[0] || {},
            relatorio,
            periodo: {
                data_inicio: data_inicio || 'Início',
                data_fim: data_fim || 'Atual'
            }
        });

    } catch (err) {
        console.error("Erro ao gerar relatório:", err);
        res.status(500).json({ erro: "Erro interno do servidor" });
    }
}