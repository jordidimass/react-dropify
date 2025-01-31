import React, { createContext, useCallback, useContext, useMemo } from 'react'
import useSWR, { KeyedMutator } from 'swr'

import { ToggleState, useToggleState } from '../../../hooks/use-toggle-state'
import { formatError } from '../../utils'
import { StandardStorefrontClient } from '.'
import { storefrontEvents } from './events'
import { _CartFragment } from './generated'

type LineItem = {
  merchandiseId: string
  quantity: number
  attributes?: { key: string; value: string }[]
}

type Context = {
  onAddLineItem: (params: LineItem, dontMutateState?: boolean) => Promise<void>
  onUpdateLineItem: (
    params: LineItem,
    dontMutateState?: boolean
  ) => Promise<void>
  onRemoveLineItem: (
    params: { merchandiseId: string },
    dontMutateState?: boolean
  ) => Promise<void>
  cart: _CartFragment | undefined | null
  cartItemsCount: number | undefined
  cartToggleState: ToggleState
  getOrCreateCart: () => Promise<_CartFragment | null | undefined>
  mutateCart: KeyedMutator<_CartFragment | null | undefined>
}

const Context = createContext<Context | undefined>(undefined)

type InternalContextProviderProps = {
  client: StandardStorefrontClient
  appCartId: string
  children?: React.ReactNode
}

const InternalContextProvider = ({
  children,
  client,
  appCartId
}: InternalContextProviderProps) => {
  const cartToggleState = useToggleState()
  const { data: cart, mutate } = useSWR('cart', cartFetcher, {
    revalidateIfStale: false,
    revalidateOnFocus: false,
    revalidateOnReconnect: false
  })

  const cartLocalStorage = useMemo(
    () => ({
      set: (id: string) => {
        localStorage.setItem(`${appCartId}-cart-id`, id)
      },
      get: () => localStorage.getItem(`${appCartId}-cart-id`),
      clear: () => localStorage.removeItem(`${appCartId}-cart-id`)
    }),
    [appCartId]
  )

  async function cartFetcher() {
    try {
      const id = cartLocalStorage.get()
      if (!id) return null
      const { cart } = await client._FetchCart({ id })
      if (cart) {
        storefrontEvents.emit('createCartSuccess', cart)
        storefrontEvents.emit('allSuccesses', {
          type: 'createCartSuccess',
          data: cart
        })
      } else {
        cartLocalStorage.clear()
        const err = new Error('Could not find cart in cartFetcher')
        storefrontEvents.emit('fetchCartError', err)
        storefrontEvents.emit('allErrors', {
          type: 'fetchCartError',
          error: err
        })
      }
      return cart
    } catch (error) {
      const formattedError = formatError(error)

      if (
        formattedError.message.includes(
          'Variable $id of type ID! was provided invalid value'
        )
      ) {
        cartLocalStorage.clear()
      }

      storefrontEvents.emit('fetchCartError', formattedError)
      storefrontEvents.emit('allErrors', {
        type: 'fetchCartError',
        error: formattedError
      })
      return undefined
    }
  }

  const createCart = useCallback(
    async (lines?: LineItem[]): Promise<_CartFragment | null | undefined> => {
      try {
        const data = lines
          ? await client._CreateCartWithLines({ lines })
          : await client._CreateCart()

        const cart = data.cartCreate?.cart
        const cartId = cart?.id

        if (cart && cartId) {
          mutate(cart, false)
          cartLocalStorage.set(cartId ?? '')
          storefrontEvents.emit('createCartSuccess', cart)
          storefrontEvents.emit('allSuccesses', {
            type: 'createCartSuccess',
            data: cart
          })
        }
        data.cartCreate?.userErrors.forEach((error) => {
          const err = new Error(`${error.code}: ${error.message}`)
          storefrontEvents.emit('createCartError', err)
          storefrontEvents.emit('allErrors', {
            type: 'createCartError',
            error: err
          })
        })
        return cart
      } catch (error) {
        const formattedError = formatError(error)
        storefrontEvents.emit('createCartError', formattedError)
        storefrontEvents.emit('allErrors', {
          type: 'createCartError',
          error: formattedError
        })
        return null
      }
    },
    [cartLocalStorage, client, mutate]
  )

  const getOrCreateCart = useCallback(async () => {
    if (cart) return cart
    return createCart()
  }, [cart, createCart])

  const onAddLineItem = useCallback(
    async (lineItem: LineItem, dontMutateState = false) => {
      try {
        let cart: _CartFragment | undefined | null
        const localStorageCheckoutId = cartLocalStorage.get()
        if (!localStorageCheckoutId) {
          // create new cart
          cart = await createCart([lineItem])
        } else {
          const { cartLinesAdd } = await client._AddLineItem({
            cartId: localStorageCheckoutId,
            lines: [lineItem]
          })
          cart = cartLinesAdd?.cart
          cartLinesAdd?.userErrors.forEach((error) => {
            const err = new Error(`${error.code}: ${error.message}`)
            storefrontEvents.emit('addLineItemError', err)
            storefrontEvents.emit('allErrors', {
              type: 'addLineItemError',
              error: err
            })
          })
        }

        if (cart && !dontMutateState) {
          mutate(cart, false)
        }

        if (cart) {
          storefrontEvents.emit('addLineItemSuccess', cart)
          storefrontEvents.emit('allSuccesses', {
            type: 'addLineItemSuccess',
            data: cart
          })
        }
      } catch (error) {
        const formattedError = formatError(error)
        storefrontEvents.emit('addLineItemError', formattedError)
        storefrontEvents.emit('allErrors', {
          type: 'addLineItemError',
          error: formattedError
        })
      }
    },
    [cartLocalStorage, client, createCart, mutate]
  )

  const onUpdateLineItem = useCallback(
    async (
      { merchandiseId, quantity, attributes }: LineItem,
      dontMutateState = false
    ) => {
      try {
        const id = cartLocalStorage.get()
        if (!id) return
        const { cartLinesUpdate } = await client._UpdateLineItem({
          cartId: id,
          lines: [{ id: merchandiseId, quantity, attributes }]
        })

        const cart = cartLinesUpdate?.cart

        if (cart && !dontMutateState) {
          mutate(cart, false)
        }

        if (cart) {
          storefrontEvents.emit('updateLineItemSuccess', cart)
          storefrontEvents.emit('allSuccesses', {
            type: 'updateLineItemSuccess',
            data: cart
          })
        }
        cartLinesUpdate?.userErrors.forEach((error) => {
          const err = new Error(`${error.code}: ${error.message}`)
          storefrontEvents.emit('updateLineItemError', err)
          storefrontEvents.emit('allErrors', {
            type: 'updateLineItemError',
            error: err
          })
        })
      } catch (error) {
        const formattedError = formatError(error)
        storefrontEvents.emit('updateLineItemError', formattedError)
        storefrontEvents.emit('allErrors', {
          type: 'updateLineItemError',
          error: formattedError
        })
      }
    },
    [cartLocalStorage, client, mutate]
  )

  const onRemoveLineItem = useCallback(
    async (
      { merchandiseId }: { merchandiseId: string },
      dontMutateState = false
    ) => {
      try {
        const id = cartLocalStorage.get()
        if (!id) return
        const { cartLinesRemove } = await client._RemoveLineItem({
          cartId: id,
          lineIds: [merchandiseId]
        })

        const cart = cartLinesRemove?.cart

        if (cart && !dontMutateState) {
          mutate(cart, false)
        }

        if (cart) {
          storefrontEvents.emit('removeLineItemSuccess', cart)
          storefrontEvents.emit('allSuccesses', {
            type: 'removeLineItemSuccess',
            data: cart
          })
        }
        cartLinesRemove?.userErrors.forEach((error) => {
          const err = new Error(`${error.code}: ${error.message}`)
          storefrontEvents.emit('removeLineItemError', err)
          storefrontEvents.emit('allErrors', {
            type: 'removeLineItemError',
            error: err
          })
        })
      } catch (error) {
        const formattedError = formatError(error)
        storefrontEvents.emit('removeLineItemError', formattedError)
        storefrontEvents.emit('allErrors', {
          type: 'removeLineItemError',
          error: formattedError
        })
      }
    },
    [cartLocalStorage, client, mutate]
  )

  const cartItemsCount = useMemo(() => {
    if (cart === null) return 0
    if (!cart?.lines?.edges) return undefined
    let result = 0
    cart?.lines?.edges.forEach((i) => {
      result += i.node.quantity
    })
    return result
  }, [cart])

  return (
    <Context.Provider
      value={{
        cart,
        getOrCreateCart,
        cartToggleState,
        cartItemsCount,
        onAddLineItem,
        onUpdateLineItem,
        onRemoveLineItem,
        mutateCart: mutate
      }}
    >
      {children}
    </Context.Provider>
  )
}

export const StorefrontProvider: React.FC<InternalContextProviderProps> = ({
  children,
  client,
  appCartId
}) => {
  return (
    <InternalContextProvider client={client} appCartId={appCartId}>
      {children}
    </InternalContextProvider>
  )
}

export const useStorefront = () => {
  const ctx = useContext(Context)
  if (ctx === undefined) {
    throw new Error('useStorefront must be used below <StorefrontProvider />')
  }
  return ctx
}
