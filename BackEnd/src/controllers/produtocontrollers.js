export async function registrarProduto(req, res) {
    const transaction = await db.getConnection();
    
    try {
        await transaction.beginTransaction();

        const { 
            nome, 
            preco, 
            estoque, 
            validade, 
            categoria_id, 
            descricao, 
            fornecedor_id,
            sku,
            preco_custo,
            estoque_minimo,
            marca
        } = req.body;

        // 1. Validações iniciais
        const camposObrigatorios = { nome, preco, estoque, categoria_id };
        const errosValidacao = validarCampos(camposObrigatorios);
        
        if (errosValidacao.length > 0) {
            return res.status(400).json({ 
                erro: "Campos obrigatórios faltando", 
                detalhes: errosValidacao 
            });
        }

        // 2. Validações de negócio
        const errosNegocio = await validarRegrasNegocio({
            nome, preco, estoque, validade, categoria_id, fornecedor_id, sku
        }, transaction);
        
        if (errosNegocio.length > 0) {
            return res.status(400).json({ 
                erro: "Erro nas regras de negócio", 
                detalhes: errosNegocio 
            });
        }

        // 3. Inserir produto
        const [result] = await transaction.execute(
            `INSERT INTO produtos 
                (nome, preco, preco_custo, estoque, estoque_minimo, validade, 
                 categoria_id, descricao, fornecedor_id, sku, marca) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                nome.trim(), 
                preco, 
                preco_custo || null, 
                estoque, 
                estoque_minimo || 5,
                validade ? new Date(validade) : null, 
                categoria_id, 
                descricao ? descricao.trim() : null, 
                fornecedor_id || null,
                sku ? sku.trim() : null,
                marca ? marca.trim() : null
            ]
        );

        // 4. Registrar movimentação de estoque inicial
        if (estoque > 0) {
            await transaction.execute(
                `INSERT INTO movimentacoes_estoque 
                    (produto_id, tipo_movimentacao, quantidade, motivo, observacao) 
                 VALUES (?, 'ENTRADA', ?, 'ESTOQUE_INICIAL', ?)`,
                [result.insertId, estoque, `Estoque inicial do produto ${nome}`]
            );
        }

        await transaction.commit();

        // 5. Buscar produto criado com joins
        const [produtoCriado] = await db.execute(
            `SELECT p.*, c.nome as categoria_nome, f.nome as fornecedor_nome 
             FROM produtos p
             LEFT JOIN categorias c ON p.categoria_id = c.id
             LEFT JOIN fornecedores f ON p.fornecedor_id = f.id
             WHERE p.id = ?`,
            [result.insertId]
        );

        res.status(201).json({
            sucesso: true,
            mensagem: "Produto registrado com sucesso!",
            dados: produtoCriado[0]
        });

    } catch (err) {
        await transaction.rollback();
        
        console.error('Erro ao registrar produto:', err);
        
        const erroTratado = tratarErroBanco(err);
        res.status(erroTratado.status).json({ 
            sucesso: false,
            erro: erroTratado.mensagem,
            ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
        });
    } finally {
        if (transaction) transaction.release();
    }
}

export async function buscarProduto(req, res) {
    try {
        const [rows] = await db.execute("SELECT * FROM produtos WHERE id = ?", [
            req.params.id,
        ]);
        if (rows.length === 0)  
            return res.status(404).json({ erro: "Produto não encontrado" });
        res.json(rows[0]);
    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
}


export async function deletarProduto(req, res) {
    try {
        // Primeiro verifica se o produto existe
        const [produto] = await db.execute("SELECT id FROM produtos WHERE id = ?", [req.params.id]);
        
        if (produto.length === 0)
            return res.status(404).json({ erro: "Produto não encontrado" });

        await db.execute("DELETE FROM produtos WHERE id = ?", [req.params.id]);
        res.json({ mensagem: "Produto deletado com sucesso!" });
    } catch (err) {
        res.status(500).json({ erro: err.message });
    }
}
